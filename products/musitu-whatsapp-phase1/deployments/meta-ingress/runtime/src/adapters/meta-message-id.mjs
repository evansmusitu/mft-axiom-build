/** Meta ids are opaque: preserve bytes, including base64 alphabet/padding.
 * Keep the existing sender size limit. Never decode, trim or strip padding.
 * Reference: Meta WhatsApp messages webhook reference (24 October 2026).
 */
const ID=/^wamid\.[A-Za-z0-9._~+/-]{1,180}={0,2}$/;
export function isMetaMessageId(value){
 return typeof value==='string'&&value.length<=186&&ID.test(value)&&!value.includes('\n')&&!value.includes('\r');
}
