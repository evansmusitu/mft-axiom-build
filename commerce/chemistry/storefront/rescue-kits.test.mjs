import test from 'node:test';
import assert from 'node:assert/strict';
import * as kits from './rescue-kits.mjs';

const check=(html,{title,source,event})=>{
  assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.match(html,new RegExp(title));
  assert.match(html,/MUSITU Chemistry Rescue 2026/);
  assert.match(html,new RegExp(`/chemistry/rescue\\?src=${source}`));
  assert.match(html,new RegExp(`data-field-event="${event}"`));
  assert.match(html,new RegExp(`data-field-detail="${source}"`));
  assert.match(html,/@media print/);
  assert.match(html,/Free Rescue/);
  assert.doesNotMatch(html,/official ZIMSEC partner|endorsed by ZIMSEC|guaranteed pass/i);
  assert.doesNotMatch(html,/https?:\/\/(?!payments\.mftintelligence\.com)/i);
};

test('teacher kit is free-first and printable',()=>{
  const html=kits.renderTeacherKit();
  check(html,{title:'Teacher Rescue Kit',source:'wa_teacher',event:'teacher_kit'});
  assert.match(html,/Give your A-Level Chemistry class the free MUSITU Rescue check/i);
  assert.match(html,/No purchase is required for a teacher to share the free Rescue campaign/i);
});

test('school kit keeps Premium optional after demonstrated interest',()=>{
  const html=kits.renderSchoolKit();
  check(html,{title:'School Rescue Pack',source:'school',event:'school_kit'});
  assert.match(html,/optionally upgrade/i);
  assert.match(html,/school plan/i);
});

test('ambassador kit prohibits spam and fabricated activity',()=>{
  const html=kits.renderAmbassadorKit();
  check(html,{title:'Rescue Ambassador Kit',source:'ambassador',event:'ambassador_kit'});
  assert.match(html,/Do not spam/i);
  assert.match(html,/fabricated accounts/i);
  assert.match(html,/fake results/i);
});
