// MUSITU ATLAS exact rational verification kernel v1.
// Independent of the MUSITU Axiom provider. No eval(), network or model inference.
export const KERNEL='atlas-rational-1.0.0';
export type Rational={n:bigint;d:bigint};
const MAX_DIGITS=90;
const MAX_TOKENS=110;
const MAX_POWER=18n;
function bad(message:string):never{throw Object.assign(new Error(message),{code:400});}
function abs(x:bigint){return x<0n?-x:x;}
function gcd(a:bigint,b:bigint):bigint{a=abs(a);b=abs(b);while(b!==0n){[a,b]=[b,a%b];}return a===0n?1n:a;}
function cap(n:bigint,d:bigint){
 if(abs(n).toString().length>MAX_DIGITS||abs(d).toString().length>MAX_DIGITS)bad('Numeric precision limit exceeded.');
}
function rat(n:bigint,d=1n):Rational{
 if(d===0n)bad('Division by zero.');
 if(d<0n){n=-n;d=-d;}
 cap(n,d);
 if(n===0n)return {n:0n,d:1n};
 const g=gcd(n,d);
 return {n:n/g,d:d/g};
}
const add=(a:Rational,b:Rational)=>rat(a.n*b.d+b.n*a.d,a.d*b.d);
const mul=(a:Rational,b:Rational)=>rat(a.n*b.n,a.d*b.d);
const neg=(a:Rational)=>({n:-a.n,d:a.d});
const divide=(a:Rational,b:Rational)=>rat(a.n*b.d,a.d*b.n);
const rem=(a:Rational,b:Rational)=>{
 if(a.d!==1n||b.d!==1n)bad('Modulo is defined for integer operands only.');
 if(b.n===0n)bad('Modulo by zero.');
 return rat(a.n%b.n);
};
function pow(a:Rational,b:Rational):Rational{
 if(b.d!==1n)bad('Exponent must be an integer.');
 if(abs(b.n)>MAX_POWER)bad('Exponent magnitude may not exceed 18.');
 if(a.n===0n&&b.n<0n)bad('Zero cannot have a negative exponent.');
 if(a.n===0n&&b.n===0n)bad('0^0 is undefined for the ATLAS verification kernel.');
 if(b.n<0n)return rat(a.d**(-b.n),a.n**(-b.n));
 return rat(a.n**b.n,a.d**b.n);
};
function asRational(number:string):Rational{
 if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(number))bad('Invalid decimal number.');
 const [integer,decimal='']=number.split('.');
 const joined=(integer||'0')+decimal;
 if(joined.length>MAX_DIGITS)bad('Number has too many digits.');
 return rat(BigInt(joined),10n**BigInt(decimal.length));
}
function scan(source:string):string[]{
 const tokens:string[]=[];let index=0;
 while(index<source.length){
  if(/\s/.test(source[index])){index++;continue;}
  const num=source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
  if(num){
   tokens.push(num[0]);index+=num[0].length;
  }else if('+-*/%^()'.includes(source[index])){
   tokens.push(source[index]);index++;
  }else bad('Unsupported character at position '+(index+1)+'.');
  if(tokens.length>MAX_TOKENS)bad('Expression is too complex.');
 }
 if(tokens.length===0)bad('Expression is empty.');
 return tokens;
}
export function computeRational(expression:string):Rational{
 if(typeof expression!=='string'||expression.length>160)bad('Expression must be up to 160 characters.');
 const tokens=scan(expression);let i=0;let depth=0;
 const peek=()=>tokens[i];
 const take=()=>tokens[i++];
 function primary():Rational{
  if(peek()==='('){
   take();depth++;if(depth>14)bad('Maximum parenthesis depth exceeded.');
   const value=sum();if(take()!==')')bad('Missing closing parenthesis.');
   depth--;return value;
  }
  const token=peek();
  if(token===undefined)bad('Expression ended unexpectedly.');
  if(/^(?:\d|\.)/.test(token)){take();return asRational(token);}
  bad('Expected a number or opening parenthesis.');
 }
 function power():Rational{
  let value=primary();
  if(peek()==='^'){take();value=pow(value,unary());}
  return value;
 }
 function unary():Rational{
  if(peek()==='+'){take();return unary();}
  if(peek()==='-'){take();return neg(unary());}
  return power();
 }
 function product():Rational{
  let value=unary();
  while(['*','/','%'].includes(peek()||'')){
   const op=take(),rhs=unary();
   value=op==='*'?mul(value,rhs):op==='/'?divide(value,rhs):rem(value,rhs);
  }
  return value;
 }
 function sum():Rational{
  let value=product();
  while(['+','-'].includes(peek()||'')){
   const op=take(),rhs=product();
   value=op==='+'?add(value,rhs):add(value,neg(rhs));
  }
  return value;
 }
 const result=sum();
 if(i!==tokens.length)bad('Unexpected token or unmatched parenthesis.');
 return result;
}
export function exactFraction(r:Rational){return r.d===1n?r.n.toString():r.n.toString()+'/'+r.d.toString();}
export function decimalDisplay(r:Rational,places=24):{text:string;rounded:boolean}{
 if(r.d===1n)return {text:r.n.toString(),rounded:false};
 let d=r.d;
 while(d%2n===0n)d/=2n;
 while(d%5n===0n)d/=5n;
 const terminating=d===1n;
 let n=abs(r.n);
 const integer=n/r.d;
 let leftover=n%r.d;
 let after='';
 for(let i=0;i<places&&leftover!==0n;i++){
  leftover*=10n;
  after+=(leftover/r.d).toString();
  leftover=leftover%r.d;
 }
 const negative=r.n<0n?'-':'';
 return {text:negative+integer.toString()+(after?'.'+after:''),rounded:!terminating||leftover!==0n};
}
// The provider output is compared exactly as a finite decimal rational.
// A small relative tolerance is disclosed rather than silently rounding.
export function compareProvider(exact:Rational,providerText:string){
 if(typeof providerText!=='string'||providerText.length>160)bad('Provider output must be a finite decimal string.');
 const cleaned=providerText.trim();
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned))
  bad('Provider output is not a supported finite decimal.');
 const negative=cleaned[0]==='-',text=cleaned.replace(/^[+-]/,'');
 let actual=asRational(text);if(negative)actual=neg(actual);
 const lhs=abs(exact.n*actual.d-actual.n*exact.d);
 const denominator=exact.d*actual.d;
 const threshold=10n**18n;
 // |diff| <= 1e-18 * max(1, |expected|), all integer arithmetic.
 const magN=abs(exact.n)>exact.d?abs(exact.n):exact.d;
 const match=lhs*threshold*exact.d<=magN*denominator;
 return {match,providerDecimal:cleaned,tolerance:'relative 1e-18 times max(1, absolute exact result)',
   exactAgreement:lhs===0n};
}
export function evaluate(expression:string,providerText?:string){
 const r=computeRational(expression);
 const v=decimalDisplay(r);
 return {
  kernel:KERNEL,expression,exact:exactFraction(r),decimal:v.text,
  decimalIsTruncated:v.rounded,verifiedBy:'independent local exact-rational parser; no Axiom service call',
  comparison:typeof providerText==='string'?compareProvider(r,providerText):null
 };
}
