# $0 LIFELINE 24/7 HOST CANDIDATE: ORACLE ALWAYS FREE ARM + HANGOVER

**Status:** researched, offline resource policy validated, NOT signed up, NOT provisioned,
NOT a native Windows x64 environment, NOT an accepted native MCP host.

## Rationale

Oracle Always Free VM.Standard.A1.Flex: as documented by Oracle **June 2026**,
**up to 2 Arm OCPUs and 12 GB RAM total (1,500 CPU-hours / 9,000 GB-hours
monthly), 200 GB total boot + block storage**, home region only.
Earlier 4-core/24GB public tutorials are now outside the current allowance.
Reference: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

MT5 developer MetaQuotes documents running MetaTrader on Linux using Wine:
https://www.mql5.com/en/articles/625

Hangover upstream ARM64 Wine compatibility bridge:
https://github.com/AndreRH/hangover/releases/tag/hangover-11.4

Third-party independent public report claims MT5 installed with Hangover
11.4 on OCI ARM and quote-history Strategy Tester succeeded:
https://github.com/altbozon/xauusd-algo-public/blob/main/docs/vps-setup.md
These claims are NOT our acceptance evidence. They used the older 4-core/24GB
quota; 2-core/12GB performance and official MetaQuotes local MCP are unproven.

## Owner identity gate (phone)

1. Open https://signup.oraclecloud.com, sign up for a legitimate single Free
   account if country and card are eligible. **User performs CAPTCHA, identity,
   billing-card verification and accepts terms**. Oracle may place a temporary
   authorization hold even when subscription is free. If an unaffordable hold or
   paid activation is required, STOP: no charges authorized.
2. Select a home region with Always Free A1 capacity; home region is
   irreversible. Do not choose region blindly when capacity is unverified.
3. In OCI, only if the console explicitly labels **both instance and image
   Always Free Eligible**, select A1.Flex, **2 OCPU, 12GB**, **Ubuntu 24.04 ARM64**,
   **50GB boot storage**, no extras/paid IPs/marketplace images or Windows
   licenses; no public inbound ports. No Pay-As-You-Go upgrade.
4. Record actual existing A1 and boot/block consumption and compile the
   local-only JSON inventory. Call `python policy.py inventory.json`.
   The result checks owner-supplied declarations, **not** the OCI bill.
5. Separately verify provider billing at $0 and set budget alarms/quota
   limits before any activity. Always Free is subject to availability and
   idle-instance reclamation, **not** guaranteed permanent uptime.
6. Only after instance approval: obtain signed upstream Hangover/Wine package
   and MetaQuotes binaries; hash/verify integrity; use fresh isolated Wine
   prefix; DO NOT blindly run third-party shell scripts or delete ~/.wine.
   Begin on a disposable nontrading profile and NO broker or investor account.
7. Perform objective validations: Wine/Hangover version and ELF/PE
   architectures, MetaTrader terminal boot, genuine MetaEditor compile of
   approved NO-ORDER EA with log showing zero errors, .ex5 SHA, Strategy
   Tester historical report, official native MCP loopback ports 22345/22346
   and distinct bearer credentials *if supported on Wine*, deny trade and
   shell APIs, resource-use stability across service restart.
8. A1 Linux ARM may support MT5 via emulation, but it is **not native Windows**;
   existing `windows/agent.py` rejects compile/backtest on non-Windows.
   DO NOT bypass that guard. A separately designed, validated ARM/Wine
   executor with identical signed job/receipt checks is required.
9. Continue using existing GitHub Windows 2022 runners for genuine native
   Windows regression. Cloudflare backend remains disconnected until seven
   private bindings and positive end-to-end negative/positive auth evidence.

## $0/availability caveats

- Oracle requires identity and card verification; the country or card may be
  rejected. Temporary verification holds can still matter to a $0 user.
- Free ARM resource capacity can be unavailable; 24/7 availability not guaranteed.
- Provider can reclaim idle free instances. Do not game idle metrics.
- Absolutely no paid VM/Windows license, no broker credentials, no order
  submission, no public RDP or exposed local MCP, no PR/main merge.
