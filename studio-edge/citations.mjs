/**
 * Deterministically validates citation INDICES against supplied, server-retrieved
 * sources. This is not fact-checking: a model can still misinterpret a source.
 * Never use this status to certify the truth of AI-generated claims.
 */
export function constrainResearchCitations(answer, sources) {
  const original = typeof answer === 'string' ? answer : '';
  const count = Array.isArray(sources) ? Math.min(sources.length,7) : 0;
  const linked = new Set();
  const invalid = new Set();
  let removedGroups = 0;

  // Match simple references like [1], [2, 3], and 【4】, but not HTML or arbitrary URLs.
  const checked = original.replace(/\[\s*(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\s*\]|【\s*(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\s*】/g,
    (entire, western, eastern) => {
      const indices = String(western || eastern).split(/[,;]/).map(value => Number(value.trim()));
      const valid = [];
      for (const id of indices) {
        if (Number.isSafeInteger(id) && id >= 1 && id <= count) {
          linked.add(id);
          if (!valid.includes(id)) valid.push(id);
        } else invalid.add(id);
      }
      if (valid.length !== indices.length) removedGroups++;
      return valid.length ? '['+valid.join(', ')+']' : '[unlinked reference]';
    });
  const validIds=Array.from(linked).sort((a,b)=>a-b);
  const discardedIds=Array.from(invalid).sort((a,b)=>a-b);
  return {
    reply:checked,
    citationAudit: {
      status:removedGroups ? 'invalid-indices-removed' : validIds.length ? 'indices-linked' : 'no-inline-citations',
      retrievedSourceCount:count,
      linkedSourceNumbers:validIds,
      invalidSourceNumbersRemoved:discardedIds,
      adjustedCitationGroups:removedGroups,
      note:'Citation numbers only were checked against retrieved source IDs. The accuracy of claims and source reliability have NOT been independently verified.'
    }
  };
}
