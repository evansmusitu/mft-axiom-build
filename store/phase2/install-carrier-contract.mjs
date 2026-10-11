import assert from 'node:assert/strict';

// Public preflight seam shared by legacy anchors and the newer JS-controlled
// install buttons. It validates handoff metadata only: physical installations
// remain a separate certification gate.
function tags(html, name, attr) {
  const results=[];
  for(const hit of html.matchAll(new RegExp("<"+name+"\\b[^>]*>", 'gi'))) {
    const value=hit[0].match(new RegExp("(?:\\s|^)"+attr+"=\"([^\"]*)\"", 'i'))?.[1];
    if(value!==undefined) results.push(value.replaceAll('&amp;', '&'));
  }
  return results;
}
function isInstallTarget(url) {
  return url.startsWith('intent://app/chemistry?') ||
    url.startsWith('sidestore://install?') ||
    url === 'https://payments.mftintelligence.com/chemistry/install';
}
function expectedCarrier(url, platform, action) {
  if(platform==='android') {
    return url.startsWith('intent://app/chemistry?action='+action+'#Intent;') &&
      /(?:^|;)package=com\.musitu\.store(?:;|$)/.test(url) &&
      /(?:^|;)scheme=musitustore(?:;|$)/.test(url) && url.endsWith(';end');
  }
  if(platform==='ios') {
    if(!url.startsWith('sidestore://install?url=')) return false;
    try {
      const target=decodeURIComponent(url.slice('sidestore://install?url='.length));
      const decoded=new URL(target);
      return decoded.protocol==='https:' && decoded.hostname==='payments.mftintelligence.com' &&
        decoded.pathname.startsWith('/store/ios/') && decoded.pathname.endsWith('.ipa');
    } catch { return false; }
  }
  if(platform==='web') return url==='https://payments.mftintelligence.com/chemistry/install';
  return false;
}
export function assertInstallCarrier(html, {platform, action}) {
  const links=tags(html, 'a', 'href');
  assert.ok(links.includes('/store/open'), platform+' '+action+': browser fallback absent');
  assert.ok(!links.some(url=>/https?:\/\/[^"\s]+\.(?:apk|ipa)(?:[?#]|$)/i.test(url)),
    platform+' '+action+': raw package download link exposed');
  const legacy=links.filter(isInstallTarget).filter(url=>platform==='web'||url!=='https://payments.mftintelligence.com/chemistry/install');
  const controlled=tags(html, 'button', 'data-musitu-install-target');
  assert.ok(legacy.length+controlled.length>0, platform+' '+action+': install target missing');
  assert.ok(legacy.length+controlled.length<=1, platform+' '+action+': more than one or mixed install carrier');
  const url=legacy[0]??controlled[0];
  assert.ok(expectedCarrier(url,platform,action), platform+' '+action+': install target does not match authorized carrier');
  return controlled.length ? 'controlled-button' : 'legacy-anchor';
}
export function assertInstallController(javascript,{transport}) {
  if(transport==='controlled-button') {
    assert.match(javascript,/data-musitu-install-target/,'install controller has no controlled target binding');
    assert.match(javascript,/musituBindInstallControl/,'install controller has no action binding');
  }
}
