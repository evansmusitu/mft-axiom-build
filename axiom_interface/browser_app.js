const DEFAULT_ROUTE = '#/home';
const LAST_ROUTE_KEY = 'axiom.browser.last-route.v1';
const SAFE_ROUTE = /^#\/(?:home|projects|work|research|create|code|live|computer|agents|automations|knowledge|memory|evidence|observability|marketplace|developer|operator|admin|settings|offline|install|trust|project)(?:\/[A-Za-z0-9._~:@+-]{1,180})*\/?$/;

function safeStoredRoute(storage) {
  try {
    const value = storage?.getItem(LAST_ROUTE_KEY) || '';
    return SAFE_ROUTE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function rememberRoute(storage, route) {
  if (!SAFE_ROUTE.test(route)) return;
  try { storage?.setItem(LAST_ROUTE_KEY, route); } catch {}
}

export function browserLaunchHref(base = document.baseURI) {
  const entry = new URL('./', base);
  entry.search = '';
  entry.hash = '/home';
  return entry.href;
}

export function normalizeBrowserEntry({location = window.location, history = window.history, storage = window.sessionStorage} = {}) {
  const current = new URL(location.href);
  const route = SAFE_ROUTE.test(current.hash) ? current.hash : safeStoredRoute(storage) || DEFAULT_ROUTE;
  const legacyIndex = /\/index\.html$/i.test(current.pathname);
  const target = new URL(legacyIndex ? './' : current.pathname || './', current);
  target.search = '';
  target.hash = route.slice(1);
  if (target.href !== current.href) history.replaceState(history.state, '', target.href);
  rememberRoute(storage, route);
  const onRouteChange = () => rememberRoute(storage, location.hash);
  window.addEventListener('hashchange', onRouteChange);
  const state = Object.freeze({
    schema:'musitu.axiom.browser-launch-state.v1',
    entryHref:browserLaunchHref(target.href),
    route,
    legacyIndexNormalized:legacyIndex,
    navigationReloaded:false,
    downloadTriggered:false,
  });
  window.AxiomBrowserApplication = state;
  window.dispatchEvent(new CustomEvent('axiom:browser-application-ready', {detail:{route}}));
  return state;
}

export const BROWSER_APPLICATION_POLICY = Object.freeze({
  canonicalPath:'/',
  defaultRoute:DEFAULT_ROUTE,
  entryUrl:'./#/home',
  routingMode:'HASH_SPA',
  originPolicy:'DEDICATED_APPLICATION_ORIGIN',
  normalLaunchDownload:false,
});
