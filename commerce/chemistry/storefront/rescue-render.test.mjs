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

test('Rescue landing exposes crawl share structured-data and versioned app-install discovery metadata',()=>{
  const html=rescue.renderRescue({source:'direct'});
  assert.match(html,/<link rel="canonical" href="https:\/\/payments\.mftintelligence\.com\/chemistry\/rescue">/);
  assert.match(html,/<meta name="robots" content="index,follow,max-image-preview:large">/);
  assert.match(html,/<meta property="og:type" content="website">/);
  assert.match(html,/<meta property="og:title" content="MUSITU Chemistry Rescue 2026">/);
  assert.match(html,/<meta property="og:url" content="https:\/\/payments\.mftintelligence\.com\/chemistry\/rescue">/);
  assert.match(html,/<meta name="twitter:card" content="summary">/);
  assert.match(html,/<link rel="manifest" href="\/chemistry\/manifest\.webmanifest\?v=2">/);
  assert.match(html,/<link rel="sitemap" type="application\/xml" href="https:\/\/payments\.mftintelligence\.com\/chemistry\/sitemap\.xml">/);
  assert.match(html,/<meta name="theme-color" content="#[0-9A-Fa-f]{6}">/);
  assert.match(html,/<script type="application\/ld\+json">/);
  assert.match(html,/"@type":"SoftwareApplication"/);
  assert.match(html,/"applicationCategory":"EducationalApplication"/);
  assert.match(html,/"operatingSystem":"Android"/);
  assert.match(html,/id="install-rescue"[^>]*hidden/);
  assert.match(html,/\/chemistry\/assets\/rescue-install\.js/);
});
