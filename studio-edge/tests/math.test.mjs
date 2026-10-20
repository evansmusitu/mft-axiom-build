import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate, CalculationError} from '../math.mjs';

const successes = [
  ['40+2',42],
  ['(12.5+7.5)/4',5],
  ['2^3^2',512],
  ['-2^2',-4],
  ['sqrt(144)+abs(-7)',19],
  ['floor(3.8)+ceil(2.1)',7],
  ['round(2.6)',3],
  ['3e2/1.5e1',20],
  ['12%5',2],
  ['(4+6)*(3-1)',20]
];
for(const [input, expected] of successes) {
  test('safe deterministic numeric expression: '+input,() => {
    const answer=calculate(input);
    assert.equal(answer.result,expected);
    assert.equal(answer.verifiedBy,'deterministic parser v1');
    assert.equal(answer.exact,false);
    assert.equal(answer.numericType,'IEEE-754 double precision');
  });
}
for(const expression of [
  '1/0','sqrt(-3)','1e999','x+y','process.exit()',
  '2**3','(1+2','0^100','2^100','5//2',
  'a'.repeat(141),'1+1;alert(1)','2+'
]) {
  test('reject unsafe or unsupported expression: '+expression.slice(0,35),() => {
    if(expression==='0^100') {
      assert.equal(calculate(expression).result,0);
    } else {
      assert.throws(()=>calculate(expression),CalculationError);
    }
  });
}
test('finite binary floating-point result with explicit approximate classification',() => {
  const answer=calculate('0.1+0.2');
  assert.ok(Math.abs(answer.result-0.3)<1e-12);
  assert.equal(answer.exact,false);
});
test('large inputs and nesting cannot bypass complexity guards',() => {
  assert.throws(()=>calculate('('.repeat(40)+'1'+')'.repeat(40)),CalculationError);
  assert.throws(()=>calculate('1+'.repeat(80)+'1'),CalculationError);
});
