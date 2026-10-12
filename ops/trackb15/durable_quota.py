"""S0 candidate: independently signed, Postgres-serialized conservative call admission.

Never distribute DB credentials to workers; route calls through independent gateway.
A reserved call is not refunded after an uncertain upstream result.
This module is NOT proof of live Cloudflare usage or a production auth gateway.
"""
import hashlib, json, re
from datetime import datetime,timezone,timedelta
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

AUDIENCE="axiom.b15.s0.reservation"
ID=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
POLICY={"audience","kind","account","day","epoch","ceiling","revoked","issued","expires"}
GRANT={"audience","kind","account","day","epoch","workload","grant_id","cost","max_calls","issued","expires"}

class Denied(Exception):pass

def integer(x,lo,hi):
    if type(x) is not int or not lo<=x<=hi:raise Denied("INVALID_INTEGER")
    return x

def ident(x):
    if type(x) is not str or not ID.fullmatch(x):raise Denied("INVALID_ID")
    return x

def stamp(x):
    if type(x) is not str or not x.endswith("Z"):raise Denied("TIMESTAMP_NOT_UTC")
    try:return datetime.fromisoformat(x[:-1]+"+00:00")
    except (ValueError,TypeError):raise Denied("TIMESTAMP_INVALID") from None

def inspect_signed(raw,sig,pub,kind):
    if type(raw) is not bytes or len(raw)>4096 or len(raw)==0 or type(sig) is not bytes or len(sig)!=64:
        raise Denied("DOCUMENT_SIZE_OR_SIGNATURE")
    try:
        d=json.loads(raw)
        if type(d) is not dict or raw!=json.dumps(d,sort_keys=True,separators=(",",":")).encode():
            raise Denied("NONCANONICAL_OR_NOT_OBJECT")
        key=load_pem_public_key(pub)
        if not isinstance(key,Ed25519PublicKey):raise Denied("INVALID_SIGNER_KEY")
        key.verify(sig,raw)
    except (InvalidSignature,UnicodeError,ValueError,TypeError):
        raise Denied("SIGNATURE_INVALID") from None
    if set(d)!=(POLICY if kind=="policy" else GRANT):raise Denied("SCHEMA_FIELDS")
    if d["audience"]!=AUDIENCE or d["kind"]!=kind:raise Denied("SCOPE")
    ident(d["account"]);integer(d["epoch"],1,2**63-1)
    if type(d["day"]) is not str or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",d["day"]):
        raise Denied("DAY_FORMAT")
    try:
        if datetime.fromisoformat(d["day"]).date().isoformat()!=d["day"]:raise ValueError()
    except ValueError:raise Denied("DAY_INVALID") from None
    issued,expires=stamp(d["issued"]),stamp(d["expires"])
    if issued>=expires or expires-issued>timedelta(minutes=30):raise Denied("SIGNED_TTL")
    if kind=="policy":
        integer(d["ceiling"],0,10000)
        if type(d["revoked"]) is not bool:raise Denied("REVOCATION_FIELD")
    else:
        ident(d["workload"]);ident(d["grant_id"]);integer(d["cost"],1,10000);integer(d["max_calls"],1,32)
    return d

def live(d,now):
    if d["day"]!=now.astimezone(timezone.utc).date().isoformat():raise Denied("NOT_DATABASE_UTC_DAY")
    if stamp(d["issued"])>now+timedelta(seconds=15) or stamp(d["expires"])<=now:
        raise Denied("SIGNED_SCOPE_NOT_CURRENT")

def init_db(conn):
    with conn.transaction():
        conn.execute("""CREATE TABLE IF NOT EXISTS b15_accounts(
          account TEXT PRIMARY KEY, day DATE NOT NULL, epoch BIGINT NOT NULL,
          ceiling BIGINT NOT NULL CHECK(ceiling BETWEEN 0 AND 10000),
          spent BIGINT NOT NULL CHECK(spent>=0), revoked BOOLEAN NOT NULL,
          expires TIMESTAMPTZ NOT NULL, last_seen TIMESTAMPTZ NOT NULL,
          policy_digest TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS b15_operations(
          account TEXT NOT NULL, day DATE NOT NULL, workload TEXT NOT NULL,
          operation TEXT NOT NULL, grant_id TEXT NOT NULL, cost BIGINT NOT NULL,
          receipt TEXT NOT NULL, created TIMESTAMPTZ NOT NULL,
          PRIMARY KEY(account,day,workload,operation))""")
        conn.execute("CREATE INDEX IF NOT EXISTS b15_grant_counter ON b15_operations(account,day,grant_id)")

class Ledger:
    def __init__(self,connect,public_pem):self.connect,self.public_pem=connect,public_pem
    def verify(self,raw,sig,kind):return inspect_signed(raw,sig,self.public_pem,kind)
    def apply_policy(self,doc,sig):
        g=self.verify(doc,sig,"policy")
        with self.connect() as conn,conn.transaction():
            conn.execute("SET LOCAL lock_timeout='5s'")
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",(g["account"],))
            row=conn.execute("""SELECT day,epoch,ceiling,spent,revoked,last_seen,policy_digest
                  FROM b15_accounts WHERE account=%s FOR UPDATE""",(g["account"],)).fetchone()
            # The independent issuer's policy also samples clock after locking.
            now=conn.execute("SELECT clock_timestamp()").fetchone()[0]
            live(g,now)
            digest=hashlib.sha256(doc).hexdigest()
            if row:
                prev_day,prev_epoch,prev_cap,spent,revoked,last_seen,prev_digest=row
                if now<last_seen:raise Denied("DATABASE_CLOCK_ROLLBACK")
                if g["day"]<prev_day.isoformat():raise Denied("DAY_ROLLBACK")
                if g["day"]==prev_day.isoformat():
                    if g["epoch"]<prev_epoch:raise Denied("EPOCH_ROLLBACK")
                    if g["epoch"]==prev_epoch:
                        if prev_digest==digest:return {"idempotent":True}
                        raise Denied("EPOCH_REUSE")
                    if g["ceiling"]>prev_cap:raise Denied("SAME_DAY_BUDGET_INCREASE")
                    if revoked and not g["revoked"]:raise Denied("REVOCATION_ROLLBACK")
                else:
                    if g["epoch"]<=prev_epoch:raise Denied("NEW_DAY_EPOCH_ROLLBACK")
                    spent=0
                conn.execute("""UPDATE b15_accounts SET day=%s,epoch=%s,ceiling=%s,
                   spent=%s,revoked=%s,expires=%s,last_seen=%s,policy_digest=%s WHERE account=%s""",
                   (g["day"],g["epoch"],g["ceiling"],spent,g["revoked"],stamp(g["expires"]),now,digest,g["account"]))
            else:
                conn.execute("""INSERT INTO b15_accounts
                  (account,day,epoch,ceiling,spent,revoked,expires,last_seen,policy_digest)
                  VALUES(%s,%s,%s,%s,0,%s,%s,%s,%s)""",
                  (g["account"],g["day"],g["epoch"],g["ceiling"],g["revoked"],stamp(g["expires"]),now,digest))
            return {"idempotent":False}
    def reserve(self,doc,sig,operation_id):
        g=self.verify(doc,sig,"grant");ident(operation_id)
        with self.connect() as conn,conn.transaction():
            conn.execute("SET LOCAL lock_timeout='5s'")
            row=conn.execute("""SELECT day,epoch,ceiling,spent,revoked,expires,last_seen
                  FROM b15_accounts WHERE account=%s FOR UPDATE""",(g["account"],)).fetchone()
            if not row:raise Denied("NO_SIGNED_POLICY")
            # Only read database time AFTER acquiring the lock: any pre-lock
            # timestamp can become stale while another broker commits.
            now=conn.execute("SELECT clock_timestamp()").fetchone()[0];live(g,now)
            day,epoch,cap,spent,revoked,expiry,last_seen=row
            if now<last_seen:raise Denied("DATABASE_CLOCK_ROLLBACK")
            if day.isoformat()!=g["day"] or epoch!=g["epoch"] or revoked or expiry<=now:
                raise Denied("POLICY_EXPIRED_OR_REVOKED")
            old=conn.execute("""SELECT grant_id,cost,receipt FROM b15_operations WHERE
               account=%s AND day=%s AND workload=%s AND operation=%s""",
               (g["account"],g["day"],g["workload"],operation_id)).fetchone()
            if old:
                if old[0]!=g["grant_id"] or old[1]!=g["cost"]:raise Denied("REPLAY_WITH_ALTERED_SCOPE")
                return {"replayed":True,"receipt":old[2]}
            used=conn.execute("""SELECT COUNT(*) FROM b15_operations WHERE
                    account=%s AND day=%s AND grant_id=%s""",
                    (g["account"],g["day"],g["grant_id"])).fetchone()[0]
            if used>=g["max_calls"]:raise Denied("WORKLOAD_GRANT_CALL_CAP")
            if spent+g["cost"]>cap:raise Denied("ACCOUNT_CAP")
            receipt=hashlib.sha256(("|".join(map(str,[g["account"],g["day"],g["workload"],
                   operation_id,g["grant_id"],g["cost"]]))).encode()).hexdigest()
            conn.execute("""INSERT INTO b15_operations(account,day,workload,operation,grant_id,cost,receipt,created)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (g["account"],g["day"],g["workload"],operation_id,g["grant_id"],g["cost"],receipt,now))
            conn.execute("UPDATE b15_accounts SET spent=spent+%s,last_seen=%s WHERE account=%s",
                         (g["cost"],now,g["account"]))
            return {"replayed":False,"receipt":receipt,"remaining":cap-spent-g["cost"]}
