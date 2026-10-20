import {database} from '../../../src/staging/database.mjs';
import {createHealthHandler} from '../../../src/staging/health.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=createHealthHandler({getPool:()=>database().pool});
