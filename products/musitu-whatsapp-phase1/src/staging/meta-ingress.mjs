import pg from 'pg';import {createRoleBoundSignedWebhookIngestor} from '../postgres/signed-inbound.mjs';
let ingestor;
export function developmentIngress(){
 if(ingestor)return ingestor;
 const required=['META_APP_SECRET','META_VERIFY_TOKEN','META_BINDINGS_JSON','META_DEVELOPMENT_RECIPIENTS_JSON','INGRESS_DATABASE_URL','PRIVACY_KEY','CONTENT_ENCRYPTION_KEY'];
 if(required.some(k=>!process.env[k]))throw Error('META_DEVELOPMENT_NOT_CONFIGURED');
 const url=new URL(process.env.INGRESS_DATABASE_URL);if(url.username!=='musitu_ingress'||url.pathname!=='/musitu_whatsapp_phase1'||!url.hostname.endsWith('.neon.tech'))throw Error('INGRESS_IDENTITY_REJECTED');url.searchParams.set('sslmode','verify-full');
 const pool=new pg.Pool({connectionString:url.href,max:2,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000});pool.on('error',()=>{});
 ingestor=createRoleBoundSignedWebhookIngestor({pool,expectedRole:'musitu_ingress',appSecret:process.env.META_APP_SECRET,bindings:JSON.parse(process.env.META_BINDINGS_JSON),allowedDevelopmentRecipients:JSON.parse(process.env.META_DEVELOPMENT_RECIPIENTS_JSON),privacyKey:Buffer.from(process.env.PRIVACY_KEY,'base64'),contentEncryptionKey:Buffer.from(process.env.CONTENT_ENCRYPTION_KEY,'base64')});
 return ingestor;
}
