import { inspectStagingHyperdrive } from './probe.mjs';

/** A closed, staging-only diagnostic Worker. No public SQL or provider routes. */
export function createStagingProbeWorker(clientFactory, logger=console){
  return {
    async fetch(){return new Response(null,{status:404});},
    async scheduled(_controller,env){
      if(env?.STAGING_DATABASE_PROBE_ENABLED!=='true')return;
      try{
        await inspectStagingHyperdrive(env,clientFactory);
        logger.info('AXIOM_STAGING_SCHEMA_PRESENT_NOT_PRODUCTION_READY');
      }catch{
        logger.error('AXIOM_STAGING_SCHEMA_BLOCKED');
      }
    }
  };
}
