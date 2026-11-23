// Not deployed. Public requests never select a private entrypoint by URL/header.
import {WorkerEntrypoint} from 'cloudflare:workers';
import {handleOAuthHandoffPrivate,handleOAuthHandoffBrowser} from './oauth_session_handoff_candidate.mjs';
export default {fetch(){return new Response('Not found.',{status:404});}};
export class OAuthSessionHandoffService extends WorkerEntrypoint {fetch(request){return handleOAuthHandoffPrivate(request,this.env);}}
export class OAuthHandoffInspector extends WorkerEntrypoint {fetch(request){return handleOAuthHandoffPrivate(request,this.env,{inspectOnly:true});}}
export class OAuthHandoffBrowserService extends WorkerEntrypoint {fetch(request){return handleOAuthHandoffBrowser(request,this.env);}}
