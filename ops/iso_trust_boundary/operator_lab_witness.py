"""S0 local witness lab; RED scaffold. No external trust or release authority."""
class WitnessHold(ValueError): pass
def bootstrap_local_witness(db_path, *, witness_id, epoch, signing_key, acknowledged_lab_only):
    raise WitnessHold('NOT_IMPLEMENTED')
class LocalWitnessLab:
    def __init__(self,db_path,*,witness_id,epoch,signing_key,clock): pass
    def reserve_once(self,request):
        raise WitnessHold('NOT_IMPLEMENTED')
