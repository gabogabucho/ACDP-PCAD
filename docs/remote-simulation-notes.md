# ACDP Remote Simulation Notes

This document captures practical notes from remote-first trial scenarios for ACDP.

It is written for operators and future agents who need a fast answer to: "What usually happens here, and how should I read it?"

See also [`remote-operations.md`](remote-operations.md) for the operating playbooks.

## Scope of these notes

- Mix of happy-path validation and simulated race / reconnect / cleanup scenarios.
- Intended to validate operator understanding of the current remote-hardening model.
- Not a claim that every edge case is fully solved.

## Trial 1 — Single-agent happy path

### Setup

- One agent
- `origin/acdp/state` available
- Standard flow: sync → `lock-remote` → work → `heartbeat` → `renew` → `release-remote`

### What passed

- The remote coordination branch acted as the clear source of truth.
- Lock lifecycle was easy to reason about when the agent kept refreshing before mutation.
- `renew` preserving the same `lock_id` made ownership history understandable.

### Operator takeaway

- If there is only one active agent, remote-first mode should feel boring.
- Boring is good here. It means the protocol is staying out of the way.

## Trial 2 — Same-resource race, loser behavior

### Setup

- Two agents sync from the same coordination revision.
- Both attempt to lock the same file remotely.

### What happened

- One write wins.
- The loser sees that the coordination head moved.
- The loser must refresh and now sees the resource as owned remotely.

### What worked

- The race resolves around authoritative remote state, not around local confidence.
- A stale `base_coord_rev` becomes an explicit reason to stop retrying blindly.

### What to watch for

- A failed remote mutation is not automatically a bug.
- The wrong reaction is: "retry exactly the same publish again."
- The right reaction is: refresh, inspect, and then either wait, request, reroute, or retry with regenerated metadata if still compatible.

## Trial 3 — Stale owner after reconnect

### Setup

- Agent held a remote lock.
- Agent disconnected long enough that another operator could have cleaned up or the TTL could have elapsed.

### What happened

- On reconnect, the agent's local memory of ownership was not enough.
- The decisive question became whether the same `lock_id` still existed and remained unexpired on the latest remote branch.

### What worked

- Reconnect logic becomes much clearer when ownership is checked against the authoritative branch instead of local history.

### What to watch for

- Agents returning from network problems are especially likely to misread stale local mirrors as truth.
- Releasing or renewing before re-sync is the dangerous move.

### Practical reading

- If the lock is gone remotely, the agent lost ownership.
- If the lock is present and fresh remotely, renew from the new base.
- If there is doubt, act as if ownership is gone until proven otherwise.

## Trial 4 — `cleanup-remote` during a renewal race

### Setup

- Cleaner sees an expired lock on an older snapshot.
- Lock owner renews near the same time.

### What happened

- Safe cleanup requires a re-fetch and re-check before publishing removal.
- If the latest remote state shows the lock was renewed, cleanup should back off.

### What worked

- The conservative cleanup rule protects against deleting a lock that is only expired on a stale snapshot.

### What to watch for

- Operators may misread a "no cleanup performed" result as useless work.
- In this scenario, doing nothing can be the correct outcome.

## Trial 5 — `doctor` and observability interpretation

### Setup

- Feature branch contains normal project work.
- Coordination branch contains newer lock / event updates.
- Local checkout may also have mirrored or edited `acdp/` files.

### What happened

- Divergence alone was not enough to conclude that coordination was unsafe.
- The more useful distinction was between:
  - expected feature-vs-coordination drift
  - stale coordination snapshot
  - local protocol files differing from authoritative remote state

### Current meaning of stale signals

#### `expected_branch_divergence`

- Usually normal.
- Means your feature branch and `acdp/state` are different in expected ways.
- Not a reason by itself to abandon work.

#### `stale_coordination_snapshot`

- Important warning.
- Means the coordination view available to this checkout is older than the authoritative remote view.
- Safe response before mutation: sync again.

#### `local_protocol_differs_from_remote`

- Interpretation signal.
- Means your local protocol files differ from the authoritative remote branch right now.
- Could be harmless mirror drift, could be risky local edits, could be a half-finished operation.

### Operator takeaway

- `doctor` helps you classify risk; it does not make every decision for you.
- The current stale signals are best used to answer: "Can I safely mutate coordination now, or should I refresh first?"

## Fast heuristics for future agents

- If remote lock truth and local memory disagree, trust remote.
- If a race happened, assume your `base_coord_rev` is stale until refreshed.
- If reconnect happened, do not renew or release from memory.
- If cleanup re-checks and finds a renewed lock, backing off is success.
- If `doctor` says authoritative files are malformed, stop coordination mutation and repair the branch.

## Recommended follow-up validation

- More multi-agent examples with explicit remote JSON output.
- More reconnect stories with near-expiry TTLs.
- A small library of operator transcripts showing how humans interpreted stale and divergence signals in practice.
