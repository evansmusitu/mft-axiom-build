# Permanent FAILURE evidence — B27 synthetic process separation is insufficient

The local B27 network-client boundary PASS cannot resolve a trust-domain rollback:
1. Use authentic, synthetic voter A+B signed receipts to obtain a signed witness
   audit receipt, with a different Ed25519 signer held in the local child process.
2. Stop the child; remove its SQLite file. Roll back/delete both voter journals.
3. Repeat the exact proposal and obtain new authentic voter and child receipts.

The replay succeeds. This is a real failure within the synthetic threat model;
its test passes precisely because the attack is demonstrated. Distinct local
PIDs and sockets do NOT confer independent custody or anti-rollback durability.
Neither B26 nor B27 may be marked globally secure, production-qualified or
externally independent. Never alter/delete this counterexample just to earn PASS.
