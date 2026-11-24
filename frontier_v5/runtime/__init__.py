from .fabric import *

# Extend the existing EnterpriseIncidentManager with the isolated Frontier
# forensic export/verification contract. This creates no parallel incident
# store or public-surface binding.
from .incident_forensics import install_incident_forensics as _install_incident_forensics

_install_incident_forensics()
del _install_incident_forensics

# Install the isolated SEC-004 inbound artifact inspection entrypoint on the
# existing ArtifactWorkbench class. Existing artifact creation methods remain
# unchanged; untrusted-file handling must enter through inspect_input first.
from .malicious_file_guard import install_secure_artifact_ingress as _install_secure_artifact_ingress

_install_secure_artifact_ingress()
del _install_secure_artifact_ingress
