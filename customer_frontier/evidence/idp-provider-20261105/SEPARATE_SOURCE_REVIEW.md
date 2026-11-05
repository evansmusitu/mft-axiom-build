# Separate software review — token verification only

Reviewer `/root/review_zitadel_tokens` inspected the two changed code/test files independently, ran executable synthetic cryptographic checks and retained exact initial source/reproductions. It made no repository edits and used no real token, credential, hosted database or provider mutation.

Initial 17 focused/166 full Node/54 Python tests passed but missed two independently reproduced findings:

1. Medium: a token expiring during a real 1300ms UserInfo wait was returned verified using the entry-time clock snapshot.
2. Lower severity: modulus byte length admitted a genuinely 2047-bit RSA signing key, below the 2048-bit requirement.

Both now fail closed and have regressions. Verification uses a trusted injectable clock after I/O and significant key bits; the final narrow check also denies backward movement between time reads. Raw original failures and the exact initial source are preserved. Final module SHA256 `bb7e3a5c718f8e8e93f3f70e2fccd1e8660e185d438a5c18b196ee20b9fcc7f4`.

Final independent results: 20 focused/169 full Node; 54 Python from the prior complete pass; no failures/skips. Root separately ran 169 Node +54 Python, syntax and the existing NOT_CERTIFIED benchmark validator. A final fixture-only replacement uses a purely synthetic subject in tests; current test SHA256 `bf50eaeeb72bb6d336967830fd346009ab616366f593f183a40d60fa6b292d16`. It does not create or prove a production account mapping.

Verdict: no unresolved material source finding in this bounded token verification scope. This is not independent human/security-authority acceptance, real signed customer session qualification, durable one-use state/PKCE proof, tenant ownership, revocation, custody or release.
