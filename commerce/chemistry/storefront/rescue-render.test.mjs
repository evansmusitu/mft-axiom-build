import test from 'node:test';
import assert from 'node:assert/strict';
import * as rescue from './rescue-render.mjs';

test('Rescue landing is free-first, privacy-safe, source-bounded and WhatsApp-shareable',()=>{
  const html=rescue.renderRescue({source:'wa_student'});
  assert.equal((html.match(/<h1\b/g)||[]).length,1);
  assert.match(html,/MUSITU Chemistry Rescue 2026/);
  assert.match(html,/How ready are you for A-Level Chemistry\? Find out free\./);
  assert.match(html,/>Start Free Rescue Check</);
  assert.match(html,/data-field-event="rescue_start"/);
  assert.match(html,/data-field-detail="wa_student"/);
  assert.match(html,/data-rescue-source="wa_student"/);
  assert.match(html,/https:\/\/wa\.me\/\?text=/);
  assert.match(html,/data-field-event="rescue_share"/);
  assert.match(html,/https%3A%2F%2Fpayments\.mftintelligence\.com%2Fchemistry%2Frescue%3Fsrc%3Dwa_student/);
  assert.match(html,/data-field-event="premium_intent"/);
  assert.match(html,/No card required/);
  for(const forbidden of ['guaranteed pass','official ZIMSEC partner','payment reference','licence token','student name','phone number']) assert.equal(html.toLowerCase().includes(forbidden.toLowerCase()),false,forbidden);

  const hostile=rescue.renderRescue({source:'school<script>alert(1)</script>'});
  assert.match(hostile,/data-rescue-source="direct"/);
  assert.equal(hostile.includes('school<script>'),false);
});
