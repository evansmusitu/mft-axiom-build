import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainResearchCitations } from '../citations.mjs';

const evidence=[{title:'One',url:'https://en.wikipedia.org/wiki/One'},{title:'Two',url:'https://news.ycombinator.com/item?id=123'}];

test('keeps numbered references that exist in retrieved evidence',()=>{
 const checked=constrainResearchCitations('A [1], B [2], and both [1, 2].',evidence);
 assert.equal(checked.reply,'A [1], B [2], and both [1, 2].');
 assert.equal(checked.citationAudit.status,'indices-linked');
 assert.deepEqual(checked.citationAudit.linkedSourceNumbers,[1,2]);
 assert.deepEqual(checked.citationAudit.invalidSourceNumbersRemoved,[]);
 assert.equal(checked.citationAudit.retrievedSourceCount,2);
});
test('strips unsupported numbers rather than linking fabricated citations',()=>{
 const checked=constrainResearchCitations('Valid [1], unsupported [99], mixed [2, 70] and zero [0].',evidence);
 assert.equal(checked.reply,'Valid [1], unsupported [unlinked reference], mixed [2] and zero [unlinked reference].');
 assert.equal(checked.citationAudit.status,'invalid-indices-removed');
 assert.deepEqual(checked.citationAudit.linkedSourceNumbers,[1,2]);
 assert.deepEqual(checked.citationAudit.invalidSourceNumbersRemoved,[0,70,99]);
 assert.equal(checked.citationAudit.adjustedCitationGroups,3);
});
test('supports East Asian citation marker typography while limiting indices',()=>{
 const checked=constrainResearchCitations('Readable 【1】, invalid 【100】, mixed 【1, 12】.',evidence);
 assert.equal(checked.reply,'Readable [1], invalid [unlinked reference], mixed [1].');
 assert.equal(checked.citationAudit.status,'invalid-indices-removed');
});
test('does not certify unsourced factual claims',()=>{
 const checked=constrainResearchCitations('This source says X, but I forgot to cite it.',evidence);
 assert.equal(checked.citationAudit.status,'no-inline-citations');
 assert.match(checked.citationAudit.note,/NOT been independently verified/);
 assert.deepEqual(checked.citationAudit.linkedSourceNumbers,[]);
});
test('rejects any claimed source ID when sources are absent',()=>{
 const checked=constrainResearchCitations('No sources [1] or [2].',[]);
 assert.equal(checked.reply,'No sources [unlinked reference] or [unlinked reference].');
 assert.equal(checked.citationAudit.retrievedSourceCount,0);
});
test('leaves non-citation formatting and external URLs unchanged',()=>{
 const input='## Example\nhttps://en.wikipedia.org/wiki/Physics and [more info](https://example.org/).';
 const checked=constrainResearchCitations(input,evidence);
 assert.equal(checked.reply,input);
});
test('does not interpret untrusted zero or huge array indices as supported links',()=>{
 const checked=constrainResearchCitations('[001] [400] [0]',evidence);
 assert.equal(checked.reply,'[1] [unlinked reference] [unlinked reference]');
 assert.deepEqual(checked.citationAudit.linkedSourceNumbers,[1]);
});
test('caps maximum trusted source index to the seven item lookup bound',()=>{
 const sources=Array.from({length:12},(_,index)=>({title:String(index)}));
 const checked=constrainResearchCitations('[7] [8]',sources);
 assert.equal(checked.reply,'[7] [unlinked reference]');
 assert.equal(checked.citationAudit.retrievedSourceCount,7);
});
