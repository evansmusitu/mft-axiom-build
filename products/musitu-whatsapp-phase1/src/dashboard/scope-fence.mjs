/** Discard late replies after business/view changes, logout or a newer request. */
export function createScopeFence(){
 let generation=0;
 return Object.freeze({begin:()=>++generation,invalidate:()=>{generation++;},current:ticket=>ticket===generation});
}
