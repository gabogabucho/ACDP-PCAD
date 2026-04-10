# Tasks: ACDP Remote Hardening

## Phase 1 — Recommended starting point

Goal: make coordination remote-first with minimal protocol surface change and no new infrastructure beyond Git.

- [ ] 1.1 Document the `acdp/state` branch as the authoritative remote coordination branch in the protocol and README.
- [ ] 1.2 Define the sync-before-mutate rule for all coordination mutations and status updates.
- [ ] 1.3 Extend the lock/event model with additive metadata: `lock_id`, `base_coord_rev`, and branch carry-through where relevant.
- [ ] 1.4 Define remote lock validity rules, including when a locally remembered lock is no longer authoritative.
- [ ] 1.5 Define retry behavior for stale coordination writes and remote head changes.
- [ ] 1.6 Define TTL/renewal/offline expectations for remote-first operation.
- [ ] 1.7 Define remote cleanup/status behavior, including safe expired-lock cleanup against changing remote state.
- [ ] 1.8 Define backward-compatibility and legacy-mode behavior for repositories that do not yet expose `acdp/state`.

## Phase 2 — Tooling support

- [ ] 2.1 Update CLI/workflow commands to fetch and inspect `origin/acdp/state` before coordination mutations.
- [ ] 2.2 Add coordination revision tracking to lock acquire/renew/release flows.
- [ ] 2.3 Add machine-readable remote status output for head revision, active locks, and stale-local detection.
- [ ] 2.4 Add safe retry/replay behavior for coordination writes that lose races.
- [ ] 2.5 Add cleanup logic that revalidates expired locks after refresh before publishing cleanup.

## Phase 3 — Adoption and migration

- [ ] 3.1 Provide a migration guide for enabling `acdp/state` on existing repositories.
- [ ] 3.2 Document legacy mode vs remote-first mode in prompts and operator guidance.
- [ ] 3.3 Add examples showing multi-agent races, renewal, reconnect, and cleanup under `acdp/state`.
- [ ] 3.4 Validate that old repositories remain usable without silent semantic breakage.

## Notes

- Phase 1 is the recommended first milestone because it hardens correctness around remote coordination without requiring a broader redesign of ACDP.
- This package is planning-only; no protocol behavior changes are made by these tasks themselves.
