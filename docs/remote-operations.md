# ACDP Remote Operations Guide

This guide is for operators running ACDP in remote-first mode with `origin/acdp/state` as the authoritative coordination branch.

The tone here is intentionally practical: what to do, what the signals usually mean, and what recent happy-path / simulated race trials suggest in real use.

For scenario-by-scenario notes, see also [`docs/remote-simulation-notes.md`](remote-simulation-notes.md).

## Migration checklist

1. Create and push `acdp/state` from a clean snapshot of the repository's canonical `acdp/` directory.
2. Verify `origin/acdp/state` contains at least `locks.json`, `events.log`, `agents.md`, `state.md`, and `governance.json`.
3. Run `node acdp/cli.js sync` and `node acdp/cli.js doctor --json` to confirm the branch is visible, the authoritative remote files parse cleanly, and protocol files are healthy.
4. Switch operators and agents to the remote-aware commands (`renew`, `status --remote`, `cleanup-remote`, `heartbeat`, `release-remote`) when the branch exists.
5. Keep legacy/local commands available for repositories that still do not expose `origin/acdp/state`.

## What recent trials suggest

These notes combine the current remote-hardening design, the implemented CLI behavior, and practical simulation passes. Treat them as operator guidance, not as a formal distributed-systems proof.

### Single-agent happy path

- Passed in the expected way.
- An agent that syncs first, acquires with `lock-remote`, renews before TTL expiry, and releases with `release-remote` sees the cleanest behavior.
- The important operator takeaway: remote-first mode is easiest when the agent treats `origin/acdp/state` as the only lock truth, not its local branch mirror.

### Same-resource race loser behavior

- The loser should not keep acting as if it "almost" owns the lock.
- The safe outcome is: fetch again, read the new coordination head, and accept that the winner now owns the resource.
- In practice, the useful signal is not "my push failed" by itself; it is "the authoritative coordination head changed, so my `base_coord_rev` is stale."

### Stale-owner / reconnect behavior

- A disconnected agent may still have uncommitted work locally, but that does **not** preserve lock ownership.
- On reconnect, the first question is whether the remote branch still contains the same `lock_id` and whether that lock is still unexpired there.
- If not, ownership is gone. Re-declare intent and reacquire rather than trying to "finish the old lock story."

### `cleanup-remote` safety under renewal race

- Current behavior is intentionally conservative and that is good.
- If cleanup sees an expired lock on an older snapshot, it must re-fetch and re-check before publishing removal.
- Practical result: a lock that was renewed just in time on the latest remote base should survive cleanup.
- Operator expectation: if cleanup does nothing after a refresh, that is often a safety success, not a failure.

### `doctor` / observability caveats

- `doctor` is best treated as a readiness and interpretation aid, not as an oracle.
- A stale signal does **not** always mean someone else broke coordination; sometimes it only means your current branch mirror is old or locally edited.
- Malformed authoritative `locks.json` or `events.log` should be treated as a hard coordination-health issue, because the remote branch stopped being trustworthy enough for safe mutation.

## How to read the remote signals

### `expected_branch_divergence`

Read this as: **"my working branch differs from `acdp/state` in ways that are normal for feature work."**

- Usually expected when your feature branch contains project code changes while `acdp/state` contains coordination-only updates.
- By itself, this is **not** a lock-loss or stale-coordination alarm.
- Do not stop work just because this is true.
- Do stop and investigate if you expected a mirrored local `acdp/` snapshot to match the remote branch and it clearly does not.

### `stale_coordination_snapshot`

Read this as: **"the coordination snapshot visible from this checkout is older than the authoritative remote coordination state."**

- This is the most important stale signal for reconnect and race handling.
- It means your local assumptions about locks, recent events, or agent status may no longer be safe for mutation.
- Before any mutate action, sync again and re-evaluate ownership.
- During pure local coding, it is a warning; before `lock-remote`, `renew`, `release-remote`, `heartbeat`, cleanup, or state publication, it is effectively a stop sign.

### `local_protocol_differs_from_remote`

Read this as: **"the protocol files in this checkout differ from what the authoritative branch currently says."**

- This can mean a harmless local mirror drift.
- It can also mean someone hand-edited protocol files locally, or a previous operation partially updated the working tree.
- Treat it as an interpretation prompt: ask whether the difference is expected, temporary, and read-only, or whether someone is about to mutate from a misleading local state.
- The backward-compatible JSON alias `local_stale` should be read the same way.

## Recommended operator playbooks

### Before session

1. Run `node acdp/cli.js sync`.
2. Run `node acdp/cli.js doctor --json`.
3. Run `node acdp/cli.js status --remote`.
4. Confirm three things before starting:
   - remote coordination exists and parses cleanly
   - no unexpected stale snapshot signal is present
   - your agent is not already holding an old lock you forgot about

If `doctor` fails on authoritative parse errors, stop and repair the coordination branch before allowing more remote mutations.

### During long task

1. Keep coding on the feature branch as usual.
2. Send `node acdp/cli.js heartbeat "still working"` periodically so observers know the agent is alive.
3. Renew before expiry with `node acdp/cli.js renew <resource|lock-id> [ttlMinutes]`.
4. Re-check `status --remote` before any important coordination mutation if the task ran long or the network was shaky.

Important: heartbeat is liveness only. It does not extend TTL. Renewal is the thing that keeps ownership alive.

### After reconnect

1. Do **not** assume the old lock is still yours.
2. Run `sync`, `doctor --json`, and `status --remote`.
3. Check whether the same `lock_id` still exists remotely and is still unexpired.
4. If yes, renew it from fresh state.
5. If no, treat ownership as lost, re-declare intent, and reacquire if needed.

Good operator habit: describe reconnect outcomes plainly in team chat or the next event message. "Back online, old lock lost, re-acquiring" is better than silently continuing.

### After conflict

1. Assume your `base_coord_rev` may be obsolete.
2. Fetch again.
3. Re-read the remote coordination state.
4. Decide which case you are in:
   - winner already owns the same resource → wait, request, or reroute work
   - both writes were compatible but the remote head moved → retry from fresh metadata
   - authoritative files became malformed or confusing → stop mutations and repair coordination health first

The main anti-pattern is blind retry from stale assumptions.

## Safety notes

- Never force-push `acdp/state`.
- Treat a missing or expired remote lock as lost ownership, even if a local checkout still remembers it.
- `cleanup-remote` is intentionally conservative: it re-fetches, revalidates expiration on the latest base, and only then publishes cleanup events.
- Expected divergence between a feature branch and `acdp/state` is normal; focus on the explicit `stale_coordination_snapshot` and `local_protocol_differs_from_remote` signals instead of assuming every diff is a problem.
- If `doctor` reports malformed authoritative `locks.json` or `events.log`, treat remote coordination as unhealthy and fix the branch before mutating coordination state.

## Practical caveats

- These notes are based on the current hardening model and simulated / practical trial interpretation, not on large-scale production benchmarking.
- Observability signals help you decide when to stop and re-sync, but they do not replace operator judgment.
- If a repository still runs in legacy mode, do not pretend the remote-first guarantees exist yet.
