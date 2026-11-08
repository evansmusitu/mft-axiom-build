import {developmentIngress} from '../../../../src/staging/meta-ingress.mjs';
import {createDevelopmentMetaHandler} from '../../../../src/adapters/meta-development-http.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const handle=createDevelopmentMetaHandler({getIngress:developmentIngress,getVerifyToken:()=>process.env.META_VERIFY_TOKEN});
export {handle as GET,handle as POST};
