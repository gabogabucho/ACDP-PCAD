# Proposal: ACDP Remote Hardening

## Summary

Evolve ACDP from a repo-local coordination model into a remote-first coordination model over Git, while keeping Git as both the transport and serialization layer. The first step is a narrow, implementable Phase 1 centered on a dedicated coordination branch: `acdp/state`.

## Motivation

The current protocol already assumes distributed operation and requires agents to pull before acting, but the coordination state still behaves like regular working-tree content on normal branches. In practice this creates avoidable ambiguity:

- coordination state competes with feature work in the same branch lifecycle
- lock validity depends too much on local assumptions instead of the remote head
- retries and conflict handling are described, but not tied to a single authoritative coordination revision
- cleanup, offline detection, and renewal are harder to automate safely when coordination mutations are mixed with code mutations

For multi-agent work across machines, the protocol needs a more explicit remote coordination surface without introducing a central service.

## Goals

- Make ACDP coordination remote-first while remaining fully Git-native.
- Define `acdp/state` as the shared coordination branch for protocol state.
- Require sync-before-mutate against the remote coordination head.
- Introduce coordination metadata that lets agents prove what revision they observed before mutating.
- Define practical retry, renewal, cleanup, and stale-lock behavior for remote operation.
- Preserve compatibility with existing repositories and local-first workflows during adoption.

## Non-Goals

- Replacing Git with a database, queue, or external lock service.
- Redesigning the whole protocol or changing project code branch conventions.
- Solving all future transport concerns in Phase 1 (for example, signatures, federation, or cryptographic lock proofs).
- Making offline agents fully autonomous for coordination mutations.

## Why this evolution is needed

ACDP already treats Git as the source of truth, but today it does not separate **coordination state exchange** from **feature development exchange**. As the number of agents grows, that gap becomes operationally expensive: more stale reads, more accidental lock races, and less confidence that a lock seen locally is still valid remotely.

Remote hardening keeps the original philosophy intact — shared files, explicit rules, no central server — while making the protocol safer for real multi-machine execution.

## Model

### Current model

- Agents read and mutate ACDP files inside their normal repo checkout.
- Coordination correctness depends on agents pulling at the right times.
- Conflicts are resolved file-by-file after the fact.

### Proposed model

- Coordination state is published on a dedicated branch: `acdp/state`.
- Feature work continues on normal working branches such as `agent/<id>/<task>`.
- Before any coordination mutation, an agent synchronizes with the remote `acdp/state` head.
- Every coordination mutation records the coordination revision it was based on.
- A mutation is only valid if it is derived from the latest acceptable remote coordination revision.

## Phase 1 scope

Phase 1 should be intentionally small and implementable:

1. Define `acdp/state` as the authoritative remote coordination branch.
2. Define sync-before-mutate as a hard precondition for lock/intention/status mutations.
3. Extend lock and coordination records with `lock_id` and `base_coord_rev` metadata.
4. Define remote lock validity, renewal, retry, and cleanup behavior.
5. Add backward-compatible fallback rules for repositories still using only in-branch ACDP files.

## Why Phase 1 is the recommended starting point

Phase 1 isolates the highest-value safety improvement — authoritative remote coordination revisions — without changing the core ACDP data model or requiring new infrastructure. It is small enough to prototype in CLI/workflow tooling and strong enough to reduce the most common race conditions immediately.

## Expected outcome

After Phase 1, ACDP remains file-based and Git-native, but agents gain a clearer contract:

- where coordination truth lives remotely
- when local state is too stale to mutate
- how to retry safely after remote changes
- how locks remain valid, expire, renew, and get cleaned up in a shared remote setting
