/** Navigation context only. Every business operation still checks membership. */
export function businessIdentifier(value){
 return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
}
export function businessSignInPath(value){const business=businessIdentifier(value);return '/auth/login'+(business?'?business='+business:'');}
export function businessDestination(value){const business=businessIdentifier(value);return business?'/?business='+business:'/';}
