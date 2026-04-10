# Spec: ACDP Remote Hardening Phase 1

## Status

Proposed.

## Overview

This specification defines Phase 1 of making ACDP remote-first over Git. It does not replace Git and does not add any central service. Git remains the transport and serialization layer; the new behavior formalizes how remote coordination state is synchronized and mutated.

## Requirement 1: Coordination branch

ACDP MUST support a dedicated coordination branch named `acdp/state`.

- `acdp/state` is the authoritative remote branch for shared coordination state in Phase 1.
- The branch stores the same protocol artifacts already used by ACDP (for example `locks.json`, `events.log`, `agents.md`, `state.md`).
- Feature branches remain unchanged and continue to carry project code work.
- Repositories MAY mirror coordination files on feature branches for human convenience, but `acdp/state` is authoritative when present.

### Scenario: Agent reads coordination state

- **Given** the repository has an `origin/acdp/state` branch
- **When** an agent needs current locks or status
- **Then** it MUST treat `origin/acdp/state` as the source of coordination truth

### Scenario: Repository has not adopted the branch yet

- **Given** the repository does not yet have `acdp/state`
- **When** an agent operates under Phase 1-aware tooling
- **Then** the agent MAY fall back to the current in-branch coordination behavior
- **And** it MUST mark remote coordination status as unavailable rather than pretending the branch exists

## Requirement 2: Sync-before-mutate

An agent MUST synchronize coordination state before any coordination mutation.

- Sync-before-mutate applies to `intent`, `lock`, `renew`, `release`, cleanup, agent operational status updates, and derived `state.md` refreshes.
- Synchronization means fetching the latest remote state for `acdp/state` and resolving the current remote coordination revision before writing.
- A local cached view of coordination state is insufficient for mutation eligibility.

### Scenario: Agent acquires a lock

- **Given** an agent wants to acquire a lock
- **When** it has not synchronized with the latest remote `acdp/state` head
- **Then** the mutation MUST be rejected locally as stale

### Scenario: Agent updates status after a long-running task

- **Given** an agent has been working offline or without sync for an extended period
- **When** it wants to update `agents.md` or `state.md`
- **Then** it MUST sync first
- **And** it MUST recompute whether its local assumptions still hold

## Requirement 3: Coordination metadata

Each remote coordination mutation MUST carry enough metadata to tie it to the coordination revision it observed.

- Lock records MUST include a unique `lock_id`.
- Mutations that create or modify lock state MUST include `base_coord_rev`.
- Coordination events related to lock lifecycle SHOULD also carry `lock_id` and `base_coord_rev`.
- Tooling MAY also record the resulting coordination revision after a successful write, but Phase 1 only requires the base revision.

### Metadata definitions

- `lock_id`: stable unique identifier for a specific lock lifecycle.
- `base_coord_rev`: the remote coordination revision the agent synchronized against before mutating.
- `branch`: the agent working branch already declared by current ACDP intent/state rules and preserved in remote coordination records when relevant.

### Scenario: Agent renews an existing lock

- **Given** an agent holds a lock and wants to renew it
- **When** it writes the renewal
- **Then** the renewal MUST reference the existing `lock_id`
- **And** it MUST include the latest synchronized `base_coord_rev`

## Requirement 4: Remote lock validity

A lock is remotely valid only when it is present in the latest accepted coordination state and not expired.

- A locally remembered lock is not sufficient proof of ownership.
- If the remote coordination state no longer contains the lock, the agent MUST consider the lock lost.
- If the lock exists remotely but its TTL has expired, the lock MUST be treated as expired even if the agent still has local work in progress.
- A lock renewal is valid only if the lock still exists on the latest remote coordination revision seen during sync-before-mutate.

### Scenario: Agent believes it still owns a lock locally

- **Given** an agent cached a lock locally
- **And** `origin/acdp/state` no longer contains that `lock_id`
- **When** the agent syncs
- **Then** the agent MUST stop treating the lock as active
- **And** it MUST re-declare intent and reacquire if work still needs exclusive access

## Requirement 5: Retry and conflict behavior

When coordination mutation races occur, agents MUST retry from fresh remote state instead of forcing local assumptions.

- If push or update of `acdp/state` fails because the remote coordination head changed, the agent MUST fetch, re-read, and re-evaluate before retrying.
- Retrying with the old `base_coord_rev` is invalid.
- If the re-read shows the requested resource is now locked or otherwise incompatible, the agent MUST follow normal wait/request/escalation rules instead of blind retry.
- Phase 1 SHOULD cap automatic retries for the same intended mutation and surface a clear conflict outcome.

### Scenario: Two agents race for the same resource

- **Given** two agents synchronized from the same coordination revision
- **When** both attempt to acquire the same lock
- **Then** only the first successful remote mutation becomes valid
- **And** the losing agent MUST fetch the new coordination state
- **And** the losing agent MUST not keep retrying with the stale `base_coord_rev`

### Scenario: Append-only event merge still succeeds

- **Given** two compatible coordination writes happen near-simultaneously
- **When** the remote branch can accept both after rebase or replay
- **Then** the agent MAY retry automatically after refresh
- **But** it MUST regenerate metadata against the new `base_coord_rev`

## Requirement 6: TTL, renewal, and offline expectations

Phase 1 MUST preserve TTL semantics while making them remote-aware.

- TTL begins from the lock acquisition timestamp recorded in coordination state.
- Renewal requires sync-before-mutate and an existing remotely valid `lock_id`.
- Agents SHOULD renew before expiry; after expiry they MUST reacquire instead of retroactively renewing.
- Offline agents MAY continue local code work at their own risk, but they MUST NOT assume coordination mutations will be accepted later without a fresh sync.
- An agent returning from offline operation MUST reconcile against remote coordination state before any further protocol action.

### Scenario: Agent returns after temporary disconnect

- **Given** an agent was offline and its lock TTL may have elapsed
- **When** it reconnects
- **Then** it MUST sync before emitting renew/release/update actions
- **And** if the lock is expired or missing remotely, it MUST treat the lock as no longer held

## Requirement 7: Remote status and cleanup

Phase 1 MUST define explicit remote observability and cleanup behavior.

- Tooling SHOULD expose remote coordination status, including current coordination branch head, active locks, expiring locks, and stale local-vs-remote situations.
- Cleanup of expired locks MUST operate against the latest synchronized remote coordination state.
- Cleanup writes MUST include `base_coord_rev` and produce normal release/cleanup events.
- Cleanup MUST be safe to run repeatedly and MUST avoid deleting remotely renewed locks that appeared after the cleaner's stale read.

### Scenario: Cleaner sees an expired lock

- **Given** a cleanup process synchronized `origin/acdp/state`
- **When** it finds a lock whose TTL is expired on that revision
- **Then** it MAY remove the lock and emit the corresponding release event
- **But** if the remote head changes before cleanup is published, it MUST re-sync and re-check before finalizing

## Requirement 8: Backward compatibility

Phase 1 MUST be adoptable incrementally.

- Existing ACDP repositories without `acdp/state` MUST continue to function under current rules.
- Existing message types and lock semantics SHOULD be preserved unless extended by new metadata.
- New metadata fields such as `lock_id` and `base_coord_rev` MUST be additive.
- Tooling SHOULD clearly report whether it is operating in legacy mode or remote-first mode.

### Scenario: Legacy repository with old lock entries

- **Given** a repository has valid ACDP coordination files but no `lock_id` metadata yet
- **When** remote-first tooling reads that repository in legacy mode
- **Then** it MUST not rewrite protocol history automatically
- **And** it SHOULD only require the new metadata once `acdp/state` mode is enabled

## Notes for implementation planning

- Phase 1 is intentionally limited to remote coordination safety, not a complete protocol rewrite.
- The preferred starting point is CLI/workflow support that can read, fetch, validate, and publish `acdp/state` safely while preserving current file formats as much as possible.
