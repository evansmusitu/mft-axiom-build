# Studio V0.3 — safe R2 reader exceptions and serialized God Mode outputs

25 October 2026. **Source-only development on the isolated Studio experiment branch.**
No live R2 objects were read, no Cloudflare routes changed, no Neon cutover occurred,
and no billable render or customer mutation was authorized.

## Reproduced defects

**Reader exception disclosure.** `verifyStudioR2ObjectBytes` trusted any external
exception starting with `STUDIO_R2_` as one of its own deterministic validation
errors. A compromised provider reader could thus smuggle a secret-bearing error
message through the public-facing rejection. Separately, a malicious iterable
could throw from `Symbol.iterator` or `Symbol.asyncIterator` before the loop's
exception handler. Both scenarios were captured by red-first tests that failed
against the live Studio source.

**Shared output races.** The God Mode launcher's atomic frame-directory lock
protected only concurrent runs using that *same* frame path. Two launches with
different frame directories could still race to overwrite the same scene file
or the same final MP4. Separate red-first subprocess tests showed both
launchers succeeding against the previous source.

## Changes

- Private `StudioR2Failure` errors distinguish validated security failures from
  untrusted provider exceptions. The latter are now normalized to
  `STUDIO_R2_READ_FAILED` without surfacing provider-controlled error strings.
  Iterable shape and getter checks occur inside the same guarded boundary.
  Deliberate input, size, hash, per-object and aggregate chunk failure codes
  remain intact.
- God Mode uses ordered, atomic local directory locks for the `.blend` output,
  the MP4 destination, and the frame directory. Locks are acquired before any
  Blender/FFmpeg process starts, and outputs are rechecked after acquisition.
  A failed acquisition releases *only* this process's earlier locks. Existing
  operator locks are never stolen or removed, and partial frame outputs are
  preserved for inspection. These guards are local file-system safety features,
  not provider hard spending stops or proof of remote exclusive leases.

## Regression and qualification

- Two leak-oriented R2 tests failed before the fix and pass afterward.
- Two simultaneous-encoding tests failed before the fix and pass afterward.
- Additional tests cover foreign scene/video lock preservation and cleanup on
  incomplete frame sequences.
- Local Node Neon: 199/199; GLB/editor: 23/23; independent Edge pure subset:
  41/41; Python Studio ops: 39/39; God Mode mock tests: 19/19 (split into two
  disjoint tranches to stay within the runner's command timeout).
- **321/321 offline tests pass**. Full dependency-dependent Edge suite and
  exact-commit hosted GitHub Actions remain separately unverified.

## Production restrictions

Production remains **NO-GO** until the provider origin, durable single-use
canary epoch, fenced atomic route adapters, owner Android approval, Cloudflare
export/R2 content attestation, verified restore and rollback, private Neon
transport, and enforceable provider hard spending controls are independently
proven. A successful local shell mock is not a Blender cinematic or a hosted
3D render.
