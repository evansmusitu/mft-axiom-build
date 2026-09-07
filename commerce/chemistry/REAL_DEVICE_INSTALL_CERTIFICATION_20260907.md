# MUSITU Chemistry — Real-Device Install Certification

Status: **PENDING PHYSICAL DEVICE EVIDENCE**

Universal install URL:
`https://payments.mftintelligence.com/chemistry/install`

This certification is intentionally separate from browser-emulation CI. No platform is marked PASS until a real device completes the required sequence and evidence is captured.

## Acceptance matrix

| Gate | Required device/browser | Required proof | Status |
|---|---|---|---|
| A1 | iPhone + Safari | adaptive Safari coach shown; Add to Home Screen completed; Home Screen icon visible; installed app opens Chemistry Rescue | PENDING |
| A2 | iPad + Safari | adaptive Safari coach shown; Add to Home Screen completed; Home Screen icon visible; installed app opens Chemistry Rescue | PENDING |
| A3 | Android + Chrome | native install prompt or trusted browser install control; app icon visible; standalone launch opens Chemistry Rescue | PENDING |
| A4 | Samsung Android + Samsung Internet | Samsung-specific install path; Home Screen/app icon visible; standalone launch opens Chemistry Rescue | PENDING |
| A5 | Android in-app/WebView | wrong-browser recovery points to Chrome/Samsung Internet; install succeeds after recovery | PENDING |
| A6 | Installed-state reopening | reopening `/chemistry/install` from installed standalone mode shows `MUSITU is installed` and `Open Chemistry Rescue` | PENDING |
| A7 | Offline reload | after at least one successful online launch, airplane/offline mode reload retains the bounded non-payment web-app shell | PENDING |
| A8 | Update/reload | after reconnecting, reload returns current live application without reinstall and without exposing checkout/payment routes from cache | PENDING |

## Required evidence per gate

Capture only non-sensitive evidence. Do not record customer names, phone numbers, emails, payment references, licence tokens, IP addresses, advertising identifiers, or other personal identifiers.

For each gate record:
- device class and OS major version;
- browser name and major version;
- local test timestamp and timezone;
- starting URL exactly `https://payments.mftintelligence.com/chemistry/install`;
- observed adaptive mode;
- result of install action;
- whether the app icon appeared;
- whether standalone launch opened Chemistry Rescue;
- whether self-diagnostics reported healthy assets if troubleshooting was required;
- screenshot(s) with personal notifications/account information cropped or hidden;
- PASS / FAIL plus exact failure text.

## Pass rules

A platform gate passes only when the full user journey completes on real hardware. A screenshot of the install page alone is not sufficient. Browser emulation, user-agent spoofing, or desktop responsive mode does not count as physical-device evidence.

The offline gate must not involve checkout, return, claim, telemetry, or plans being served from the service-worker cache. Payment and entitlement authority remain network/server authoritative.

## Execution order

1. Android Chrome on an available physical Android phone.
2. Installed-state reopening on that same device.
3. Offline reload and reconnect/update behavior on that same device.
4. Android in-app browser recovery on that same device when possible.
5. Samsung Internet on a Samsung device.
6. iPhone Safari.
7. iPad Safari.

## Certification boundary

Until all applicable gates above are supported by real-device evidence, the authoritative statement remains:

**Adaptive install concierge live and browser-emulation verified; physical-device certification incomplete.**
