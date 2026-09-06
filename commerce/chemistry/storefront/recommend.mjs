export function recommendPlan(input={}){
  const who=String(input.who||'').toLowerCase();
  if(who==='myself'||who==='child'){
    const duration=String(input.duration||'').toLowerCase();
    if(duration==='term')return 'term';
    if(duration==='year')return 'annual';
    if(duration==='permanent')return 'lifetime';
    return null;
  }
  if(who==='multiple'){
    const context=String(input.context||'').toLowerCase();
    if(context==='home')return 'family';
    if(context==='tutor')return 'tutor';
    if(context==='school')return 'school';
  }
  return null;
}
