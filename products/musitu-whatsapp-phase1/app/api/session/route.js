import {authenticate} from '../../../src/staging/identity.mjs';
import {createSessionStatusHandler} from '../../../src/staging/session-status.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const GET=createSessionStatusHandler({authenticate});
