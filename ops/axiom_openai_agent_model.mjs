import {createGovernedAgentModel} from './axiom_agent_model_store.mjs';

/** Explicit server selection; reuse keys in memory, never copy them to a sandbox. */
export async function createConfiguredOpenAIAgentModel(env,{db,customer,taskId,governance}={}){
  if(env.AXIOM_AGENT_PROVIDER!=='openai_agents')return null;
  if(env.AXIOM_OPENAI_AGENTS_ADMITTED!=='true')throw new DOMException('OpenAI hosted execution requires server admission','NotAllowedError');
  if(typeof env.OPENAI_API_KEY!=='string'||!env.OPENAI_API_KEY.trim())throw new DOMException('existing OpenAI credential binding unavailable','NotSupportedError');
  const model=env.OPENAI_AGENTS_MODEL||'gpt-6-astra';
  const {createHostedAgentClient}=await import('../integrations/openai-agents/client.mjs');
  const client=createHostedAgentClient({apiKey:env.OPENAI_API_KEY,model});
  return createGovernedAgentModel({db,customer,taskId,governance,client,model,admitted:true});
}
