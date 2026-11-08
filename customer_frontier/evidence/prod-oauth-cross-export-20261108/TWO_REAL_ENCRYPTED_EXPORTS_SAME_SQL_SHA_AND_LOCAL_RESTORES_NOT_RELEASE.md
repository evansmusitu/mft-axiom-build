# MUSITU AXIOM — two distinct real production OAuth encrypted D1 exports, same authenticated source SQL — 8 November 2026

**Result: TWO ENCRYPTED EXPORTS, IDENTICAL 2,453,521-BYTE SOURCE SQL SHA-256; THREE ISOLATED LOCAL MEMORY RESTORES TOTAL. NOT HOSTED RECOVERY, NOT PRODUCTION MIGRATION, NOT RELEASE.**

## Production OAuth identity
Fixed protected production OAuth D1 `504029cc-f9a5-495e-818f-63c6144b4ea4`, account `93f395f5121954671f92fffa453d6b61`; 33-object catalog SHA-256 `56c70460aecf66af4eab25d4c7e363efb0a76866f788bcd5ae70f52a0f3e7ee1`. Both official Cloudflare D1 export workflows performed only metadata GET, SELECT-only catalog read and polling logical export; no production schema or row writes.

## First separately reviewed export and two private restores (PR131–133)
- PR132 live run `42457620412` SUCCESS: owner-only envelope **3,272,893 bytes**, SHA256 `4c4dd4f0d99830b7af6f086e70145602503b09cdc394592cd36cca75f17c5a56`.
- Private Drive encrypted ZIP `19DOs2Ay7C4USaILla0WpCl5UDliIDzhO`, ZIP SHA256 `b936035dbcb0ce54e26f2c47e83248c0d3cbd061b191f1ff8a56da10476f15cd`, byte-identical readback, owner-only ACL. Original detailed PR133 evidence `customer_frontier/evidence/prod-oauth-private-backup-20261108/ACTUAL_PROD_OAUTH_ENCRYPTED_BACKUP_TWO_LOCAL_RESTORES_NOT_RELEASE.md`.
- Two distinct Python memory-only SQLite restores verified **17 user tables, 15 indexes, 4,612 records**, zero FK violations, sqlite integrity OK. Original authenticated SQL **2,453,521 bytes**, SHA256 `c8eb426f629d3ef6d84a88aa5e11603e2d2637b266706288435b710537b3b304`. Safe receipt private Drive `1fHf-i9NvatRJ4Vwz1m_1Gf7hb6UH0F__`.

## Fresh second export and a third independent-operator local recovery (PR139–140)
- PR139 immutable source and offline tests run `42459837608` PASS; PR140 actual exporter run `42459936050`, job `128666850670` SUCCESS. Five Cloudflare requests HTTP 200; zero-write catalog query, 33-object catalog exact SHA, owner public RSA4096 recipient SHA256 `d97bd50654cd7a02c55d25ebce421e1fc31642f1c4a57d2a24eafe9f5e328fd3`.
- Fresh randomized AES-256-GCM + RSA-OAEP-SHA256 envelope **3,272,893 bytes**, SHA256 `07313f1b0c45a7732b6256b9fba000f34fdec0e481c9011901d063b7eea60523`; ZIP **2,465,968 bytes**, SHA256 `6067c6136ce95e54b54cc4b408f694c257481aa00671e94dfe00f08ed410f217`, CRC PASS. Private owner-only Drive `1vUna6KauU5mp63yfjHhCoqgQy7wTRv_4`, uploaded/downloaded ZIP exact SHA/size/CRC checked, `shared=false` and ACL owner only. [Private fresh backup](https://drive.google.com/file/d/1vUna6KauU5mp63yfjHhCoqgQy7wTRv_4/view).
- In third fresh isolated Python process, authenticated owner AES-GCM/RSA-OAEP envelope and SHA/size bound to production D1 identity and catalog; source SQL **2,453,521 bytes**, SHA256 **`c8eb426f629d3ef6d84a88aa5e11603e2d2637b266706288435b710537b3b304` EXACT SAME AS PR133 PREVIOUS REAL EXPORT**. SQLite `:memory:` executed only fixed-class PRAGMA/CREATE/INSERT statements: 1 PRAGMA, 32 CREATE, 4,612 INSERT; restored 17 tables/15 indexes/4,612 records, FK check zero and sqlite `integrity_check=ok` with `foreign_keys=ON`. No plaintext source or actual OAuth records saved to disk; owner private RSA local copy unlinked. Safe local JSON receipt was generated in operator workspace, not independently attested as custody evidence.

## Data/custody/release boundaries
Matching independently authenticated original plaintext SQL SHA and byte count across the two production exports demonstrates **cross-export logical SQL identity at their observed moments**, not proof of continuous database immutability between observations and not a hosted full-database disaster-recovery exercise. Encrypted envelopes intentionally differ due fresh random keys/nonces.

PR136 actual production structural audit had **3 previously used/unregistered OAuth flows**; PR138 fresh read-only expiry follow-up showed all **3 expired**, **0 unexpired**, **0 invalid dates**, and **3 distinct unknown clients**. Neither cleanup, ownership validation nor production migration was authorized.

No production OAuth data/schema writes, no cross-account import of real OAuth token/signing secrets, no charges, no merger or publication. Production OAuth-specific **hosted** destructive recovery and 89-statement upgrade remain blocked. Genuine IdP customer ownership/onboarding, provider execution cancellation/final usage, Paynow settlement/devices, independent custody/B27 (failed synthetic attack), PR83 full-stack security veto and reviewer acceptance remain unqualified; release authority false. PR1/83 remain DRAFT/UNMERGED, $0 spend authority.
