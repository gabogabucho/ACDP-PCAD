# Tasks: ACDP Remote Hardening

## Phase 1 — Recommended starting point

Goal: make coordination remote-first with minimal protocol surface change and no new infrastructure beyond Git.

- [x] 1.1 Document the `acdp/state` branch as the authoritative remote coordination branch in the protocol and README.
- [x] 1.2 Define the sync-before-mutate rule for all coordination mutations and status updates.
- [x] 1.3 Extend the lock/event model with additive metadata: `lock_id`, `base_coord_rev`, and branch carry-through where relevant.
- [x] 1.4 Define remote lock validity rules, including when a locally remembered lock is no longer authoritative.
- [x] 1.5 Define retry behavior for stale coordination writes and remote head changes.
- [x] 1.6 Define TTL/renewal/offline expectations for remote-first operation.
- [x] 1.7 Define remote cleanup/status behavior, including safe expired-lock cleanup against changing remote state.
- [x] 1.8 Define backward-compatibility and legacy-mode behavior for repositories that do not yet expose `acdp/state`.

## Phase 2 — Tooling support

- [x] 2.1 Update CLI/workflow commands to fetch and inspect `origin/acdp/state` before coordination mutations.
- [x] 2.2 Add coordination revision tracking to lock acquire/renew/release flows.
- [x] 2.3 Add machine-readable remote status output for head revision, active locks, and stale-local detection.
- [x] 2.4 Add safe retry/replay behavior for coordination writes that lose races.
- [ ] 2.5 Add cleanup logic that revalidates expired locks after refresh before publishing cleanup.

## Phase 3 — Adoption and migration

- [ ] 3.1 Provide a migration guide for enabling `acdp/state` on existing repositories.
- [ ] 3.2 Document legacy mode vs remote-first mode in prompts and operator guidance.
- [ ] 3.3 Add examples showing multi-agent races, renewal, reconnect, and cleanup under `acdp/state`.
- [ ] 3.4 Validate that old repositories remain usable without silent semantic breakage.

## Notes

- Phase 1 is the recommended first milestone because it hardens correctness around remote coordination without requiring a broader redesign of ACDP.
- The checked items in this task list represent work already implemented for the first remote-hardening milestone; the remaining unchecked items are follow-up work.
