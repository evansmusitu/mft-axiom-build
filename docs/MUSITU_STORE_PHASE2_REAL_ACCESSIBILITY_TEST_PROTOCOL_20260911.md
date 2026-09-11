# MUSITU Store Phase 2 — Real Accessibility Certification Protocol

Date: 2026-09-11  
Scope: `https://payments.mftintelligence.com/store`  
Store identity under test: 1.0.2 / catalog revision 3  
Phase: 2 standards hardening  
Status: execution protocol; this file is not evidence and does not itself establish WCAG conformance.

## 1. Why testing the current live Store is valid for the hardened candidate

Do not perform this protocol unless the GitHub workflow **MUSITU Store Phase 2 Response Body Equivalence** is PASS.

That workflow reconstructs the exact current Store 1.0.2 baseline and the bounded hardened candidate from the same verified catalog and proves byte-for-byte response-body equality across the accessibility-relevant route matrix. The only permitted differences are the intended security headers. Therefore a real screen-reader/keyboard/reflow test of the current live Store body is applicable to the hardened candidate only while that equivalence proof remains PASS and the hardened candidate source remains unchanged.

If the equivalence workflow fails or the candidate UI/body changes after the proof, invalidate this manual evidence and repeat the protocol.

## 2. Preferred test environment

Use a real Windows 11 computer with a current Microsoft Edge, Google Chrome, or Firefox browser and the built-in Microsoft Narrator screen reader. This gives one environment capable of satisfying the keyboard, real screen-reader, and browser zoom/reflow requirements.

Microsoft's current Narrator documentation identifies:

- `Windows + Ctrl + Enter` — start/stop Narrator.
- `Narrator + Spacebar` — toggle Scan Mode. Caps Lock and Insert are Narrator keys by default.
- In Scan Mode: `H` / `Shift+H` — next/previous heading.
- In Scan Mode: `D` / `Shift+D` — next/previous landmark.
- In Scan Mode: `K` / `Shift+K` — next/previous link.
- `Narrator + F5` — list landmarks.
- `Narrator + F6` — list headings.
- `Narrator + F7` — list links.
- `Narrator + Alt + X` — open **Speech Recap**, which shows Narrator's recent spoken strings and provides **live transcription of Narrator speech**. Keep this window visible in the recording during the real screen-reader section so spoken output is independently reviewable from the video itself.

Official references:

- https://support.microsoft.com/en-us/accessibility/windows/narrator/chapter-2-narrator-basics
- https://support.microsoft.com/en-us/accessibility/windows/narrator/chapter-3-using-scan-mode
- https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-b-narrator-keyboard-commands-and-touch-gestures
- https://support.microsoft.com/en-us/accessibility/windows/narrator/complete-guide-to-narrator

A different real screen reader is acceptable only if its actual spoken output is also made observable in the evidence (for example an official speech-viewer/transcript window), and the packet records the exact screen-reader name/version and equivalent commands used.

## 3. Evidence rule — one continuous recording is enough

Create **one continuous screen recording** covering sections 4 through 8. Do not cut around failures. If a check fails, leave the failure in the recording and mark the packet FAIL until the underlying product is corrected and the full protocol is repeated.

The single recording may satisfy all recording references in the JSON packet by using the same immutable file reference plus timestamp ranges, for example:

`drive://<file-id>#t=00:03:15-00:04:10`

The evidence packet must also record the recording's exact SHA-256 and byte length before acceptance. A Google Drive file ID, GitHub artifact/release reference, or other stable retrievable reference is acceptable when paired with SHA-256 and byte length.

Never record passwords, API keys, recovery codes, payment credentials, private messages, or unrelated personal information.

## 4. Start the recording and prove the environment

While recording:

1. Show the operating-system version (`winver` is sufficient on Windows).
2. Show the browser name and version using the browser's About page.
3. Open Narrator settings (`Windows + Ctrl + N`) and show that Microsoft Narrator is the active real screen reader. Record its displayed version if available; otherwise record the Windows build as the Narrator version basis and state that in tester notes.
4. Open `https://payments.mftintelligence.com/store/healthz` and record the visible production health response.
5. Open `https://payments.mftintelligence.com/store` in a normal browser tab. Do not use browser developer tools to substitute for real user interaction.

Record these exact values in `test_environment` in the certification packet.

## 5. Keyboard-only checks — Narrator may be OFF for this section

Use no mouse/touch input for the checks below.

1. Put focus into the webpage document. Press `Tab` and verify the first page control reached is **Skip to main content**.
2. Press `Enter` on the skip link and verify focus moves into the main content.
3. Continue using `Tab` and `Shift+Tab` through all visible interactive controls. Verify:
   - the focus order is logical;
   - every control has a clearly visible focus indicator;
   - there is no keyboard trap;
   - every interactive control is reachable.
4. Using keyboard only, open and return from:
   - `/store/install`
   - `/store/apps/chemistry`
   - `/store/status`
   - `/store/developer`
5. Open `/store?lite=1` and verify the **Low-bandwidth mode** content and primary actions are keyboard operable.
6. Record PASS/FAIL for every key in `manual_keyboard_checks`.

A single failure makes the manual keyboard gate FAIL.

## 6. Real screen-reader checks — Microsoft Narrator

Start Narrator with `Windows + Ctrl + Enter`. Ensure speech is audible in the recording. Turn on Scan Mode with `Narrator + Spacebar` if it is not already active.

**Before judging any spoken output, press `Narrator + Alt + X` to open Speech Recap and keep its live-transcription window visible throughout this section.** Verify that the text in Speech Recap visibly updates as Narrator speaks. If live transcription is not visible, the screen-reader evidence gate is not acceptable even if audio is present.

On `/store`:

1. Verify Speech Recap live transcription is visible and updating from real Narrator output.
2. Verify the page/window title is announced meaningfully.
3. Use `Narrator + F5` and/or Scan Mode `D` to verify landmarks are discoverable, including the main landmark and navigation landmarks.
4. Use `Narrator + F6` and/or Scan Mode `H` to navigate headings. Verify the hierarchy and spoken names are understandable.
5. Use `Narrator + F7` and/or Scan Mode `K` to navigate links. Verify link/button names make sense without surrounding visual context.
6. Locate the Install action and verify its spoken name is clear.
7. Navigate the Chemistry product card/details and verify product name and version information is understandable.
8. Verify publisher/verification information is understandable.
9. Verify the distinction between distribution/install and entitlement/payment/licensing is understandable where presented.
10. Verify status information is not communicated only by color.

Then test these routes with Narrator and Speech Recap still running:

11. `/store/install` — verify install instructions/actions are understandable and operable.
12. `/store/offline` — verify offline/recovery information is understandable.
13. `/store?lite=1` — verify Low-bandwidth mode is announced/understandable and its Install/Details actions are operable.
14. During the complete screen-reader traversal, verify there is no blocking unlabeled control and no unrecoverable focus loss.

Record PASS/FAIL for every key in `screen_reader_checks`, including `narrator_speech_recap_live_transcription_visible`. Any failure makes the screen-reader gate FAIL.

## 7. Zoom and reflow checks

Narrator may remain on or be turned off. Use the browser's own Zoom control rather than operating-system display scaling.

1. Set browser zoom to **200%**. Verify primary Store content and controls remain usable and no content/control is clipped.
2. Set browser zoom to **400%**. Verify equivalent reflow remains usable.
3. At each zoom level, traverse the main Store flow and check that a user is not forced into two-dimensional scrolling to read/use primary content.
4. Record PASS/FAIL for every key in `zoom_reflow_checks`.

If the browser cannot select exactly 400%, use the closest supported level at or above 400% and record the exact level in tester notes.

## 8. Close the recording without hiding failures

Before stopping the recording:

1. State or visibly type whether any check failed.
2. If a check failed, do not mark the packet PASS.
3. Stop Narrator if desired with `Windows + Ctrl + Enter`.
4. Stop the screen recording.

## 9. Evidence integrity

For the continuous recording and any supplementary file:

- retain the original file;
- calculate SHA-256;
- record exact byte size;
- record capture timestamp in UTC;
- upload to a stable retrievable location;
- do not transcode or edit after calculating the recorded hash.

The packet may point several evidence fields to the same recording with different timestamp fragments.

Use `store/phase2/prepare_manual_accessibility_evidence.ps1` after the original recording has a stable reference. The helper has its own Windows CI smoke certification and only fingerprints evidence/gathers environment metadata; it never marks accessibility checks PASS.

Example:

```powershell
powershell -ExecutionPolicy Bypass -File .\store\phase2\prepare_manual_accessibility_evidence.ps1 `
  -RecordingPath "C:\path\to\MUSITU_Store_Phase2_Accessibility.mp4" `
  -Reference "drive://<stable-file-id>" `
  -Browser Edge
```

## 10. Acceptance boundary

Manual evidence is acceptable only when all of the following are true:

- response-body equivalence workflow is PASS;
- the environment metadata is complete;
- every keyboard check is `true`;
- every screen-reader check is `true`, including visible Narrator Speech Recap live transcription;
- every zoom/reflow check is `true`;
- evidence references are complete;
- evidence integrity metadata is complete;
- no failure has been omitted or reinterpreted;
- the packet has been reviewed against the original evidence and marked `PASS_REVIEWED_REAL_ASSISTIVE_TECHNOLOGY_EVIDENCE`.

Only then may the Phase-2 guarded production workflow pass its pre-mutation manual accessibility gate.

This protocol does **not** authorize changing sealed `main`, rewriting Phase-1 evidence, changing catalog/APK identities, or claiming complete WCAG 2.2 AA conformance beyond the evidence actually established.
