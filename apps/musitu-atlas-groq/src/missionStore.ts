export type Milestone = {
  id: string;
  title: string;
  detail: string;
  success: string;
  status: 'todo' | 'doing' | 'done';
  evidence: string;
};
export type Mission = {
  id: string;
  goal: string;
  title: string;
  summary: string;
  createdAt: string;
  origin: 'ai' | 'manual';
  steps: Milestone[];
};
const KEY = 'atlas_missions_v2';
export function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
}
function isMilestone(s: unknown): s is Milestone {
  if (!s || typeof s !== 'object') return false;
  const v = s as Partial<Milestone>;
  return typeof v.id === 'string' && typeof v.title === 'string' && typeof v.detail === 'string'
    && typeof v.success === 'string' && ['todo','doing','done'].includes(String(v.status))
    && typeof v.evidence === 'string';
}
export function readMissions(): Mission[] {
  try {
    const items:unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(items)) return [];
    return items.filter((m):m is Mission => {
      if (!m || typeof m !== 'object') return false;
      const v = m as Partial<Mission>;
      return typeof v.id === 'string' && typeof v.goal === 'string' && typeof v.title === 'string'
        && typeof v.summary === 'string' && typeof v.createdAt === 'string'
        && Array.isArray(v.steps) && v.steps.length > 0 && v.steps.length <= 12
        && v.steps.every(isMilestone) && (v.origin === 'ai' || v.origin === 'manual');
    }).slice(0,30);
  } catch { return []; }
}
export function storeMissions(missions:Mission[]): boolean {
  try {localStorage.setItem(KEY,JSON.stringify(missions.slice(0,30)));return true;}
  catch{return false;}
}
export function missionProgress(m:Mission): number {
  return Math.round(100 * m.steps.filter(x => x.status === 'done').length / m.steps.length);
}
export function summarizeMissions(missions:Mission[]) {
  return {total:missions.length, complete:missions.filter(m => missionProgress(m)===100).length,
    stepsDone:missions.reduce((n,m)=>n+m.steps.filter(s=>s.status==='done').length,0)};
}
