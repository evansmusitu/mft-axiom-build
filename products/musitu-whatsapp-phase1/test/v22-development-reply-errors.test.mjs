import test from 'node:test';
import assert from 'node:assert/strict';
import {publicDevelopmentReplyFailure,developmentReplyFailureNotice} from '../src/staging/development-reply-errors.mjs';
test('authentication rejection gives a credential recovery reason rather than an unknown send outcome',()=>{
 const failure=publicDevelopmentReplyFailure(Error('META_CREDENTIAL_REJECTED'));
 assert.equal(failure.status,503);assert.deepEqual(failure.body,{error:'META_CREDENTIAL_REJECTED'});
 assert.match(developmentReplyFailureNotice(failure.body.error),/renew it/);
 assert.match(developmentReplyFailureNotice(failure.body.error),/No reply was sent/);
 const optedOut=publicDevelopmentReplyFailure(Error('CUSTOMER_OPT_OUT'));
 assert.equal(optedOut.status,409);assert.match(developmentReplyFailureNotice(optedOut.body.error),/renewed consent/);
 assert.match(developmentReplyFailureNotice('DEVELOPMENT_UNCERTAIN_ATTEMPT'),/Do not send again/);
});
test('unknown and inherited error names never expose provider messages or secrets',()=>{
 for(const code of ['sensitive-token-raw-provider-message','toString','constructor','__proto__',null,{}]){
  assert.equal(publicDevelopmentReplyFailure({message:code}),null);
  const notice=developmentReplyFailureNotice(code);assert.match(notice,/Check reply status/);assert.equal(notice.includes('sensitive-token'),false);
 }
});
