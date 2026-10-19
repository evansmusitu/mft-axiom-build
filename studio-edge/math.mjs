/**
 * Deterministic calculation capability. No eval, Function constructor, or model-generated code.
 * All computation is IEEE-754 floating point; not suitable for accounting or safety-critical use.
 */
export class CalculationError extends Error {
  constructor(message) { super(message); this.name='CalculationError'; }
}

const LIMIT = 140;
const FUNCTIONS = new Set(['sqrt','abs','floor','ceil','round']);
const MAX_NODES = 90;
function normalize(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e14) {
    throw new CalculationError('Result outside the supported finite numeric range.');
  }
  return Object.is(value,-0) ? 0 : value;
}

export function calculate(expression) {
  if (typeof expression !== 'string' || expression.length > LIMIT || expression.trim().length === 0) {
    throw new CalculationError('Enter an arithmetic expression of 1–140 characters.');
  }
  if (!/^[\d.eE+\-*/^()% a-zA-Z]+$/.test(expression)) {
    throw new CalculationError('Unsupported characters in the expression.');
  }
  let position = 0, nodes = 0, depth = 0;
  const value = expression.trim();
  const cost = () => {if(++nodes > MAX_NODES) throw new CalculationError('Expression is too complex.');};
  const skip = () => {while (position<value.length && value[position]===' ') position++;};
  const match = x => {skip();if(value.startsWith(x,position)){position+=x.length;return true;}return false;};
  function expressionRule() {
    let result = term();
    while(true) {
      if(match('+')) {cost();result=normalize(result+term());}
      else if(match('-')) {cost();result=normalize(result-term());}
      else return result;
    }
  }
  function term() {
    let result = unary();
    while(true) {
      if(match('*')) {cost();result=normalize(result*unary());}
      else if(match('/')) {
        cost();
        const divisor=unary();
        if(divisor===0) throw new CalculationError('Division by zero is not defined.');
        result=normalize(result/divisor);
      } else if(match('%')) {
        cost();
        const divisor=unary();
        if(divisor===0) throw new CalculationError('Remainder by zero is not defined.');
        result=normalize(result%divisor);
      } else return result;
    }
  }
  function unary() {
    if(match('+')) {cost();return unary();}
    if(match('-')) {cost();return normalize(-unary());}
    return power();
  }
  function power() {
    const base=primary();
    if(match('^')) {
      cost();
      const exponent=unary();
      if(Math.abs(exponent)>40) throw new CalculationError('Exponent magnitude exceeds 40.');
      return normalize(Math.pow(base,exponent));
    }
    return base;
  }
  function primary() {
    cost();skip();
    if(++depth > 20) throw new CalculationError('Too many nested parentheses.');
    try {
      if(match('(')) {
        const result=expressionRule();
        if(!match(')')) throw new CalculationError('Missing closing parenthesis.');
        return result;
      }
      const identifier=/^[a-zA-Z]+/.exec(value.slice(position));
      if(identifier) {
        const name=identifier[0].toLowerCase();
        position+=identifier[0].length;
        if(!FUNCTIONS.has(name)) throw new CalculationError('Unsupported function: '+name);
        if(!match('(')) throw new CalculationError('Expected opening parenthesis after '+name);
        const argument=expressionRule();
        if(!match(')')) throw new CalculationError('Expected closing parenthesis for '+name);
        if(name==='sqrt') {
          if(argument<0) throw new CalculationError('Square root requires a nonnegative value.');
          return normalize(Math.sqrt(argument));
        }
        if(name==='abs') return normalize(Math.abs(argument));
        if(name==='floor') return normalize(Math.floor(argument));
        if(name==='ceil') return normalize(Math.ceil(argument));
        return normalize(Math.round(argument));
      }
      const numeric=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(value.slice(position));
      if(!numeric) throw new CalculationError('Expected a number, parenthesis or supported function.');
      position+=numeric[0].length;
      return normalize(Number(numeric[0]));
    } finally { depth--; }
  }
  const result=expressionRule();
  skip();
  if(position!==value.length) throw new CalculationError('Unexpected characters at position '+(position+1)+'.');
  return { expression: value, result, numericType:'IEEE-754 double precision', exact:false, nodes, verifiedBy:'deterministic parser v1' };
}
