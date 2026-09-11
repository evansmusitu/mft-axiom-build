# Paynow live-mode activation status at handoff

Date: 2026-09-11

Integration ID: `26343`
Merchant: MFT

## Test evidence already supplied to Paynow

- Paynow reference: `60480278`
- Test result: `Paid (TESTING: Faked Success)`
- Test date: 5 September 2026

## Gmail support thread

Thread ID: `1a0851d1b9ad9f75`

Message 1:
- sent: 2026-09-09
- message ID: `1a0851d1b9ad9f75`
- subject: `Urgent: Please Set MFT Paynow Integration 26343 Live`
- requested Test -> Live activation or the exact remaining requirement.

Message 2:
- sent: 2026-09-11
- message ID: `1a0900d469f36356`
- subject: `Re: Urgent: Please Set MFT Paynow Integration 26343 Live`
- repeated the exact activation request and asked Paynow to state the blocker if activation cannot yet be completed.

At handoff the thread contains only those two outbound MFT messages. No inbound human Paynow support reply is present in the thread.

## Continuation rule

In the new chat, re-read this exact Gmail thread first. If a Paynow reply has arrived, follow its exact verified requirement. If no reply has arrived, do not send another immediate duplicate merely because the chat changed.

The current production fallback remains constrained by `manual_verified_settlement_only`. Do not issue entitlement from an unverified order, pending status, test result, screenshot, or customer assertion alone.
