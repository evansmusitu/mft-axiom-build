"""Generate only PR77 test-fixture SQL and the reviewed 89-statement plan.

Requires a separate checkout of the immutable PR77 source at ./pr77.
Never reads private production exports, credentials, OAuth signing keys or real users.
"""
import json, pathlib, re, sqlite3, sys

ROOT=pathlib.Path('pr77').resolve()
EXPECTED_SHA='6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a'

def generate():
    if not (ROOT/'customer_frontier/tests/test_oauth_identity_upgrade.py').is_file():
        raise ValueError('PR77_REVIEWED_FIXTURE_MISSING')
    sys.path.insert(0,str(ROOT/'customer_frontier/tests'))
    from test_oauth_identity_upgrade import migration, fixture, link
    plan=migration.build_plan()
    if len(plan['statements'])!=89 or plan['plan_sha256']!=EXPECTED_SHA:
        raise ValueError('PR77_89_STATEMENT_PLAN_DRIFT')
    db=fixture(old=False)
    try:
        link(db,'token','key-a')
        link(db,'code','code-a')
        pending=''
        groups={'table':[],'index':[],'insert':[],'trigger':[]}
        for line in '\n'.join(db.iterdump()).splitlines(keepends=True):
            pending+=line
            if not sqlite3.complete_statement(pending):continue
            sql=pending.strip();pending=''
            if sql in ('BEGIN TRANSACTION;','COMMIT;'):continue
            if sql.startswith('CREATE TABLE'):groups['table'].append(sql)
            elif sql.startswith(('CREATE INDEX','CREATE UNIQUE INDEX')):groups['index'].append(sql)
            elif sql.startswith('INSERT INTO'):groups['insert'].append(sql)
            elif sql.startswith('CREATE TRIGGER'):groups['trigger'].append(sql)
            else:raise ValueError('UNADMITTED_FAKE_SQL')
        if pending.strip():raise ValueError('FAKE_DUMP_INCOMPLETE')
        ordered=['customers','api_keys','oauth_authorization_codes','oauth_access_tokens','oauth_refresh_tokens','oauth_identity_links','oauth_identity_token_links','oauth_identity_code_links']
        def rank(stmt):
            m=re.match(r'INSERT INTO ["\x60]?([A-Za-z_][A-Za-z0-9_]*)',stmt)
            if not m or m.group(1) not in ordered:raise ValueError('FAKE_INSERT_TARGET_NOT_REVIEWED')
            return ordered.index(m.group(1))
        groups['insert'].sort(key=rank)
        seed=[sql for g in ('table','index','insert','trigger') for sql in groups[g]]
        if {k:len(v) for k,v in groups.items()}!={'table':8,'index':1,'insert':11,'trigger':21} or len(seed)!=41:
            raise ValueError('PR77_SYNTHETIC_SEED_COUNT_DRIFT')
        alternate=sqlite3.connect(':memory:',isolation_level=None)
        try:
            alternate.execute('PRAGMA foreign_keys=ON')
            alternate.executescript('BEGIN;\n'+'\n'.join(seed)+'\nCOMMIT;')
            if alternate.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or alternate.execute('SELECT count(*) FROM pragma_foreign_key_check').fetchone()[0]!=0:
                raise ValueError('SYNTHETIC_SQLITE_SEED_NOT_VALID')
            migration.upgrade(alternate)
            if alternate.execute('SELECT count(*) FROM oauth_identity_schema_versions').fetchone()[0]!=1:
                raise ValueError('SYNTHETIC_SQLITE_PR77_UPGRADE_UNQUALIFIED')
        finally:alternate.close()
        output={'schema':'musitu.axiom.pr77_fixed_synthetic_plan.v1','origin':'SYNTHETIC_ONLY','plan_sha256':EXPECTED_SHA,'seed':seed,'plan':plan['statements']}
        value=json.dumps(output,sort_keys=True,separators=(',',':'))
        for denied in ('504029cc-f9a5-495e-818f-63c6144b4ea4','e36972b3-850d-4273-b934-2fa67587d9f1','c954f0c842a486d0388c05b19cd21e47'):
            if denied in value:raise ValueError('PRODUCTION_OR_ACCOUNT_ID_IN_SYNTHETIC_SQL')
        pathlib.Path('pr77-synthetic-fixture-20261108.json').write_text(value+'\n')
        safe={'schema':'musitu.axiom.pr77_synthetic_d1_generator_receipt.v1','status':'EXACT_PR77_89_AND_SYNTHETIC_41_SQLITE_PASS','plan_sha256':EXPECTED_SHA,'seed_statements':41,'reviewed_plan_statements':89,'real_customer_data_used':False,'cloudflare_operations':0,'release_authority':False}
        pathlib.Path('pr77-synthetic-generator-safe-receipt-20261108.json').write_text(json.dumps(safe,sort_keys=True,indent=2)+'\n')
        print(json.dumps(safe,sort_keys=True))
    finally:db.close()

if __name__=='__main__':generate()
