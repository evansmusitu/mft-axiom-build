// Published evidence is guidance, NOT MUSITU measurement. No inference is performed here.
// Numbers are intentionally attributed to their reporting organizations and to benchmark/evaluation variants.
export type TaskKind='everyday'|'automation'|'codebase'|'coding'|'documents'|'science'|'volume'|'zero_cash';
export type Pick={task:TaskKind;title:string;model:string;label:string;why:string;officialEvidence:string;source:string;sourcePublisher:string;relativeCost:string;maxOutputTokens:number;costForOneThousandInAndFiveHundredOut:number};
export const officialBenchmarkDate='2026-10-20';
export const officialPicks:Pick[]=[
 {task:'everyday',title:'Advanced everyday work',model:'openai_sol',label:'GPT-6.1 Sol',
  why:'OpenAI describes near-Astra professional-work capability at substantially lower token cost. Best default for complex analysis and mission planning.',
  officialEvidence:'OpenAI positioning: near-Astra performance for complex work at lower cost (not a benchmark win).',
  source:'https://developers.openai.com/api/docs/models/gpt-6.1-sol',sourcePublisher:'OpenAI',
  relativeCost:'$2 input / $10 output per million tokens',maxOutputTokens:600,costForOneThousandInAndFiveHundredOut:0.007},
 {task:'automation',title:'Computer & business execution',model:'openai_astra',label:'GPT-6 Astra',
  why:'Top published automation and computer-use performance in OpenAI release; reserve for high-impact supervised workflows because it costs more.',
  officialEvidence:'AutomationBench 41.4%; OSWorld 2.0 72.6% (OpenAI reported, 2026 benchmark versions).',
  source:'https://openai.com/index/gpt-6-astra/',sourcePublisher:'OpenAI',
  relativeCost:'$10 input / $50 output per million tokens',maxOutputTokens:650,costForOneThousandInAndFiveHundredOut:0.035},
 {task:'codebase',title:'Complex software engineering',model:'claude_opus',label:'Claude Opus 5.5',
  why:'Anthropic reports strong merge-quality coding results on large, difficult codebases. Use for genuinely hard engineering, not each trivial edit.',
  officialEvidence:'FrontierCode v1.1 main 54.4% (Anthropic reported; matched harness cannot be assumed across all competitors).',
  source:'https://www.anthropic.com/claude-opus-5-5',sourcePublisher:'Anthropic',
  relativeCost:'$4 input / $20 output per million tokens',maxOutputTokens:600,costForOneThousandInAndFiveHundredOut:0.014},
 {task:'coding',title:'Scoped coding & bug fixes',model:'claude_sonnet',label:'Claude Sonnet 5.5',
  why:'Strong publisher-reported agentic coding for bounded edits with lower cost than premium extended models.',
  officialEvidence:'Terminal-Bench 4.0 70.6% at reported evaluation settings (Anthropic); scores differ by effort and harness.',
  source:'https://www.anthropic.com/claude-sonnet-5-5',sourcePublisher:'Anthropic',
  relativeCost:'$2 input / $10 output per million tokens',maxOutputTokens:600,costForOneThousandInAndFiveHundredOut:0.007},
 {task:'documents',title:'Documents & polished communication',model:'claude_sonnet',label:'Claude Sonnet 5.5',
  why:'Anthropic positions Sonnet 5.5 for documents, slides, spreadsheets and well-scoped professional deliverables; a qualitative vendor claim, not a head-to-head proof.',
  officialEvidence:'Anthropic release describes improved professional content and document creation; no directly comparable document score claimed.',
  source:'https://www.anthropic.com/claude-sonnet-5-5',sourcePublisher:'Anthropic',
  relativeCost:'$2 input / $10 output per million tokens',maxOutputTokens:650,costForOneThousandInAndFiveHundredOut:0.007},
 {task:'science',title:'Hard scientific & mathematical reasoning',model:'openai_astra',label:'GPT-6 Astra',
  why:'OpenAI reports exceptionally strong advanced mathematics and science results. Reserve for difficult technical work.',
  officialEvidence:'FrontierMath Tier 4 (v2): 98% in OpenAI reporting; evaluated on a particular benchmark, not all maths.',
  source:'https://openai.com/index/gpt-6-astra/',sourcePublisher:'OpenAI',
  relativeCost:'$10 input / $50 output per million tokens',maxOutputTokens:650,costForOneThousandInAndFiveHundredOut:0.035},
 {task:'volume',title:'Cost-sensitive high volume',model:'openai_luna',label:'GPT-6 Luna',
  why:'Official OpenAI model guidance chooses Luna as a low-cost GPT-6 for focused tasks; quality trade-offs require monitoring.',
  officialEvidence:'OpenAI describes Luna as its fastest and most cost-efficient GPT-6 model; not an across-task accuracy benchmark.',
  source:'https://developers.openai.com/api/docs/guides/latest-model',sourcePublisher:'OpenAI',
  relativeCost:'$0.10 input / $0.50 output per million tokens',maxOutputTokens:500,costForOneThousandInAndFiveHundredOut:0.00035},
 {task:'zero_cash',title:'No-credit safe experiment',model:'beam_free',label:'Beam free-only',
  why:'This route is explicitly zero-rated by model identifier; it is an operational fallback, NOT a model-quality winner.',
  officialEvidence:'Free-only provider pricing is not an intelligence benchmark.',
  source:'https://vercel.com/changelog/reflection-ai-beam-now-available-on-ai-gateway-for-free',sourcePublisher:'Vercel',
  relativeCost:'Free-only route while supported (failure rather than paid fallback)',maxOutputTokens:400,costForOneThousandInAndFiveHundredOut:0}
];
export function pick(task:unknown):Pick{
 const taskType=typeof task==='string'?task:'';
 return officialPicks.find(item=>item.task===taskType)||officialPicks[0];
}
export function classifyPrompt(input:unknown):TaskKind{
 const q=typeof input==='string'?input.toLowerCase().slice(0,700):'';
 // Deterministic hints. They are routing heuristics, not proof of intent or benchmark scores.
 if(/(?:no budget|\$0|completely free|zero cost)/.test(q))return 'zero_cash';
 if(/(?:browser automation|click through|crm|computer use|agentic workflow|webhook automation)/.test(q))return 'automation';
 if(/(?:architecture|migration|codebase|refactor|repository|system design|multi-file)/.test(q))return 'codebase';
 if(/(?:bug fix|debug|typescript|python code|programming|write code)/.test(q))return 'coding';
 if(/(?:document|presentation|slides|spreadsheet|email|professional writing|copywriting)/.test(q))return 'documents';
 if(/(?:proof|theorem|physics|chemistry|mathematics|scientific research)/.test(q))return 'science';
 if(/(?:batch|bulk|high volume|thousands of requests|throughput)/.test(q))return 'volume';
 return 'everyday';
}
