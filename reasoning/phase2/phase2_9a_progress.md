# Phase 2.9A remote worker control progress

Issue #21, GitLab base `2433415fd44252e756557dc8791ab4c502e337e3`. Feature `feature/phase2-9a-worker-control-http`.

Test-first signed HTTP ingress and security work is on the source branch. Missing-module RED pipeline 3016056079. Syntax and fixture failures corrected without weakening signed lease/denial assertions. Verified SQLite test at `942cad5c` pipeline 3016063242 SUCCESS. Added Phase2.9A gate `23ce4083` and real PostgreSQL HTTP parity `bdfc5caf`.

Required before merge: complete feature-head CI (P1, P2 + all gates through P2.9A, PostgreSQL), security review, MR-native success, no-squash merge preserving source, and exact merged-main CI. Only CLAIM, HEARTBEAT and RELEASE; remote COMPLETE/FAIL_TERMINAL remain prohibited pending independent result replay proof. TLS/mTLS deployment, hardware key ops, trusted remote data and no-profit-guarantee remain explicitly separate.
