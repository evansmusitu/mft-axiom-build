import test from 'node:test';
import assert from 'node:assert/strict';
import {answer} from './worker.mjs';

// Deterministic MFT business QA benchmark. Not a comparison with Meta Business Agent.
const checks=[
 ['Hi',/A-Level Study Notes/],['hello',/Welcome/],['0',/Show Menu/],
 ['1',/A-Level subject/],['Lower 6 notes',/Lower 6/],['Chemistry notes',/A-Level subject/],
 ['ZIMSEC syllabus',/A-Level subject/],['2',/not guaranteed/],['2026 predictions',/not guaranteed/],
 ['Are predictions accurate?',/not guaranteed/],['3',/subject, level and paper number/],
 ['Physics past paper 2022',/paper number/],['past exams',/which papers/],
 ['4',/paper number and year/],['marking scheme',/marking schemes/],['mark scheme',/marking schemes/],
 ['5',/MFT support/],['human support',/MFT support/],['WhatsApp',/MFT support/],
 ['price',/does not collect payments/],['How much for Chemistry notes?',/does not collect payments/],
 ['Can I pay EcoCash?',/does not collect payments/],['I want to buy the notes',/does not collect payments/],
 ['Are the 2026 ZIMSEC papers leaked?',/cannot.*(leak|secret|exam questions)/i],
 ['Are you officially affiliated with ZIMSEC?',/not affiliated|independent/i],
 ['Can I share my OTP and password?',/never share|do not share/i]
];
for(const [prompt,mustHave] of checks){
 test('MFT scenario: '+prompt,()=>{
  const reply=answer(prompt);
  assert.match(reply,mustHave,'Customer-service reply missing verified fact for: '+prompt);
  assert.match(reply,/MFT EDUCATION NEXUS \| WhatsApp: 0781572008/);
  assert.doesNotMatch(reply,/100% guaranteed|exact leaked answers/i);
 });
}
