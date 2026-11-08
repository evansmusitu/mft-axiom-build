import {createConversationPrivacyExporter} from '../../../../../../../src/postgres/conversation-privacy-export.mjs';
import {createConversationPrivacyReviewHandler} from '../../../../../../../src/staging/privacy-review.mjs';
import {authenticate} from '../../../../../../../src/staging/identity.mjs';
import {database,scoped} from '../../../../../../../src/staging/database.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req,context){
 const handler=createConversationPrivacyReviewHandler({enabled:process.env.PRIVACY_DEVELOPMENT_REVIEW_ENABLED==='YES',appOrigin:process.env.APP_ORIGIN,authenticate,
  authorizeOwner:({tenantId,actorId})=>scoped(tenantId,actorId,['OWNER'],async()=>true),
  exportConversation:input=>createConversationPrivacyExporter({pool:database().pool,contentKey:Buffer.from(process.env.CONTENT_ENCRYPTION_KEY||'','base64')})(input)});
 return handler(req,context);
}
