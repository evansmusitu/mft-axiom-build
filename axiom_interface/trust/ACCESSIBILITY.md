# Axiom accessibility conformance status

Target: WCAG 2.2 AA across the product, with relevant AAA criteria where feasible.

Current status: inherited automated browser regressions cover keyboard navigation, visible focus, Control/Command+K composer focus, semantic labels, route ownership, reduced-motion operation, and selected non-drag controls. Phase-specific screenshots and machine-readable evidence are retained where CI completed.

Not yet claimed: independent WCAG 2.2 AA conformance, disabled-user testing, assistive-technology coverage across the full matrix, real-device mobile certification, or accessibility of an external production deployment.

## Required behavior

- Complete keyboard navigation with no traps and predictable focus.
- Semantic landmarks, headings, labels, status announcements, and errors.
- Color-independent status, high contrast, text zoom/reflow, and reduced motion.
- Touch-target sizing and a non-drag alternative for every drag interaction.
- Captions/transcripts and adjustable speaking rate where audio is present.
- Accessible authentication and equivalent text/table forms for charts.

Independent review must publish the tested commit, browser/OS/assistive-technology matrix, failures, exceptions, severity, and retest evidence. Until that exists, the claim-authorization display must show accessibility certification as blocked.

