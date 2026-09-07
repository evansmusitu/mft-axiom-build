from .fabric import *

# Extend the existing EnterpriseIncidentManager with the isolated Frontier
# forensic export/verification contract. This creates no parallel incident
# store or public-surface binding.
from .incident_forensics import install_incident_forensics as _install_incident_forensics

_install_incident_forensics()
del _install_incident_forensics
