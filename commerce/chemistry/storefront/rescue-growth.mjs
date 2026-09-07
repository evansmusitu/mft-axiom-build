export const GROWTH_SOURCES=Object.freeze(['wa_student','wa_teacher','school','creator','meta','tiktok','ambassador','direct']);
const GROWTH_SOURCE_SET=new Set(GROWTH_SOURCES);

export function normalizeGrowthSource(value){
  const v=typeof value==='string'?value:'';
  return GROWTH_SOURCE_SET.has(v)?v:'direct';
}
