"""B15 S0 fail-closed quota candidate. Red-phase scaffold only."""
AUDIENCE="axiom.b15.s0.reservation"
class Denied(Exception): pass
def init_db(conn): pass
class Ledger:
    def __init__(self, connect, public_pem): self.connect,self.public_pem=connect,public_pem
    def apply_policy(self,doc,sig): raise NotImplementedError("signed-policy admission not implemented")
    def reserve(self,doc,sig,operation_id): raise NotImplementedError("atomic reservation not implemented")
