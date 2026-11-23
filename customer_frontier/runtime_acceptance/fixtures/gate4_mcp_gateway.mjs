// Local test ingress only. The published gateway is an unchanged Git fixture.
import published from '../../tests/fixtures/gate4-published-gateway/gateway.mjs';
import {withCanonicalMCPAdmission} from '../../../mcp/canonical_mcp_admission_candidate.mjs';
export default withCanonicalMCPAdmission(published);
