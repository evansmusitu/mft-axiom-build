# MUSITU Store — isolated browser/PWA qualification (2026-10-18)

**Status: PHASE 1 RUNNING. This is a browser acceptance qualification, not a published
storefront release, Play Store equivalent, or complete PWA-install certificate.**

## Production-like browser behavior verified locally in CI

The branch-only `browser-runtime.test.mjs` spins up the **actual repository
Store Worker** behind an ephemeral localhost HTTP adapter and exercises it
with a real headless Chromium instance (the CI runner's Chrome, via Playwright).
It checks real HTML/CSP accessibility landmarks, manifest registration,
service-worker lifecycle, installed offline shell startup, network-only
catalog/signature treatment when offline, and browser-first links without
APK/IPA download events. Localhost is a secure context for service workers;
there is **no public DNS, production Cloudflare deploy, end-user traffic,
real entitlement, checkout or native-app installation** in these tests.

The PWA manifest now uses `/store/` as its start URL, within the
`/store/` service-worker scope. The service worker caches that exact
start URL, not an out-of-scope `/store` route. A previously reported
`navigator.serviceWorker.controller` timeout reproduced the scoping
problem under real Chromium. Existing browser navigation at `/store`
remains available online; the installed app's scoped home is `/store/`.

## Detached signature protection / cache isolation

The detached signed catalog at `/store/catalog.json` and its signature at
`/store/catalog.sig` are **network-only** in the Store service worker.
Previously each was separately cached, permitting unrelated revisions or
partially refreshed catalog-signature pairs to be presented from old caches.
The worker does not attempt to recover that pair from offline storage without
an independently verified *atomic signed-bundle* implementation.

Store offline shell cache revision `musitu-store-r3` is deployed only
within the isolated GitHub branch. Activation removes stale cache names
**starting with `musitu-store-`** and never indiscriminately deletes
other applications' local Cache Storage. An executable worker simulation
exercises the actual Service Worker event handlers and proves that
`musitu-chemistry-offline-v1`, `premium-entitlement-cache` and unrelated
web-app caches survive upgrades. Real Chromium separately verifies the new
scoped cache and network-only catalog behavior.

An offline HTML shell does **not** equal an authenticated offline catalog,
offline customer entitlement, full offline web application, qualified
PWA install prompt, or a successful OS-native installation. The PWA
manifest's installability icons and actual browser-prompt approval must
be qualified separately before claiming `installed`. No APK or IPA may be
installed silently by ordinary browser links.

## Reproduction

On a trusted isolated Linux runner with Chrome available:

```sh
python3 store/phase1/web-surface/build_store_data.py
npm install --prefix store/phase1/web-surface --no-save --no-package-lock --ignore-scripts playwright@1.55.0
CHROME_BIN="$(command -v google-chrome)" \
  node --test store/phase1/web-surface/*.test.mjs
```

GitHub Actions workflow:
`.github/workflows/musitu-store-v2-browser-pwa-regression-ci.yml`.

**Outstanding release gates:** production credential/key custody, signed
atomic offline catalog delivery, multi-publisher onboarding, real user
installation/update, Windows installation, lawful purchases/refunds,
support operations, physical Android/mobile browser matrix, explicit
user release authorization, and phase-two independent competitive
benchmarks. Do not merge protected main or modify frozen PR #1.
