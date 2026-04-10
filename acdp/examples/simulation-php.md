# Simulation: Basic PHP Website

This simulation demonstrates how ACDP coordinates three agents building a landing page in PHP with a contact form that saves to MySQL and sends an email.

## Agents

| Agent          | Type   | Role      | Area                   |
|----------------|--------|-----------|------------------------|
| `gabriel`      | human  | architect | Project owner          |
| `agent-claude` | AI     | developer | Frontend + PHP logic   |
| `agent-gemini` | AI     | developer | Backend + database     |

## Target Structure

```
/public/index.php
/public/contacto.php
/src/db/connection.php
/src/db/migrations/001_create_contacts.sql
/src/mail/send.php
/config/app.php
/config/.env
```

---

## Timeline

### Minute 0 — Registration

Gabriel initializes the repo and registers both agents. All three register in the protocol.

```
gabriel: "I need a PHP landing page with a contact form that saves to MySQL and sends an email."
```

### Minute 1 — Intent Declaration

- **agent-claude** declares intent: build the PHP frontend pages (`/public/`) and the contact form.
- **agent-gemini** declares intent: set up the database, connection, and mail sending logic (`/src/`).

No conflict. Each agent works in separate areas.

### Minute 2 — Locks and Parallel Work

- `agent-claude` locks `public/` (scope: directory). Starts building `index.php` and `contacto.php`.
- `agent-gemini` locks `src/db/` (scope: directory). Creates the connection and SQL migration.
- `agent-gemini` also locks `config/app.php` (scope: file).

**Both work in parallel without issues.** Resources don't overlap.

### Minute 5 — Conflict #1: Database Interface

`agent-claude` finishes the HTML form in `contacto.php` and needs to write the POST handler. This requires calling `saveContact()` from `src/db/connection.php`.

**But `agent-gemini` holds a directory lock on `src/db/`.** Claude cannot lock `src/db/connection.php` because a directory lock containing it exists (lock hierarchy rule).

**Resolution:**

1. `agent-claude` sends `wait` — blocked on `src/db/`.
2. `agent-claude` sends `request` — asks gemini to release or share the interface.
3. `agent-gemini` reads the request in `events.log`.
4. `agent-gemini` sends `notify` — "saveContact() is in src/db/connection.php, accepts ($name, $email, $message). Uses PDO with config from config/app.php."
5. `agent-gemini` sends `release` for `src/db/`.
6. `agent-gemini` sends `ack` with `accepted: true`.

**Claude can proceed.** Takes a file lock on `src/mail/send.php` and writes the form handler.

### Minute 8 — Conflict #2: Shared Config

`agent-claude` needs SMTP constants from `config/app.php`. But `agent-gemini` still holds the lock.

**Resolution:**

1. `agent-claude` sends `request` — needs SMTP constants in `config/app.php`.
2. `agent-gemini` responds with `ack` accepted: **false** — still writing there.
3. `agent-gemini` sends `update` — "Finishing config/app.php in ~2 minutes, will include SMTP constants."
4. `agent-gemini` adds `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` to `config/app.php`.
5. `agent-gemini` sends `release` for `config/app.php`.
6. `agent-gemini` sends `notify` — "Config done. SMTP constants available."

**Claude reads the notification** and continues with `src/mail/send.php`.

### Minute 12 — Done

1. `agent-gemini` sends `complete` — database and config ready.
2. `agent-claude` sends `complete` — frontend and contact logic ready.
3. Gabriel reviews, tests, and merges.

---

## What the Protocol Solved

| Situation | Without ACDP | With ACDP |
|-----------|--------------|-----------|
| Both touch `config/app.php` | Merge conflict, one overwrites the other | Gemini kept the lock, communicated status, Claude waited |
| Claude needs `src/db/connection.php` | Doesn't know if the interface is ready | request → notify with the exact function signature |
| Parallel work | Possible but risky | Guaranteed conflict-free via locks + scopes |
| Traceability | "Who changed what?" → `git blame` | `events.log` shows INTENT, not just the change |

---

## Complete events.log

```jsonl
{"type":"register","agent":"gabriel","timestamp":"2026-04-10T10:00:00-03:00","data":{"role":"architect"}}
{"type":"register","agent":"agent-claude","timestamp":"2026-04-10T10:00:30-03:00","data":{"role":"developer"}}
{"type":"register","agent":"agent-gemini","timestamp":"2026-04-10T10:00:45-03:00","data":{"role":"developer"}}
{"type":"intent","agent":"agent-claude","timestamp":"2026-04-10T10:01:00-03:00","data":{"task":"Build landing page and contact form","branch":"agent/agent-claude/frontend","resources":["public/","src/mail/send.php"]}}
{"type":"intent","agent":"agent-gemini","timestamp":"2026-04-10T10:01:15-03:00","data":{"task":"Set up database, connection, and config","branch":"agent/agent-gemini/backend","resources":["src/db/","config/app.php"]}}
{"type":"lock","agent":"agent-claude","timestamp":"2026-04-10T10:02:00-03:00","data":{"resource":"public/","scope":"directory","reason":"Building index.php and contacto.php","ttl_minutes":30}}
{"type":"lock","agent":"agent-gemini","timestamp":"2026-04-10T10:02:10-03:00","data":{"resource":"src/db/","scope":"directory","reason":"Creating connection and migration","ttl_minutes":30}}
{"type":"lock","agent":"agent-gemini","timestamp":"2026-04-10T10:02:20-03:00","data":{"resource":"config/app.php","scope":"file","reason":"Writing database and app config","ttl_minutes":30}}
{"type":"wait","agent":"agent-claude","timestamp":"2026-04-10T10:05:00-03:00","data":{"resource":"src/db/","held_by":"agent-gemini"}}
{"type":"request","agent":"agent-claude","timestamp":"2026-04-10T10:05:10-03:00","data":{"to":"agent-gemini","action":"release src/db/ or share saveContact() interface","reason":"Need to call saveContact() from contacto.php"}}
{"type":"notify","agent":"agent-gemini","timestamp":"2026-04-10T10:05:30-03:00","data":{"message":"saveContact() is in src/db/connection.php — accepts ($name, $email, $message). Uses PDO with config from config/app.php.","severity":"info"}}
{"type":"release","agent":"agent-gemini","timestamp":"2026-04-10T10:05:45-03:00","data":{"resource":"src/db/"}}
{"type":"ack","agent":"agent-gemini","timestamp":"2026-04-10T10:05:50-03:00","data":{"reference":"agent-claude:request:2026-04-10T10:05:10-03:00","accepted":true}}
{"type":"lock","agent":"agent-claude","timestamp":"2026-04-10T10:06:00-03:00","data":{"resource":"src/mail/send.php","scope":"file","reason":"Writing mail sending logic","ttl_minutes":30}}
{"type":"request","agent":"agent-claude","timestamp":"2026-04-10T10:08:00-03:00","data":{"to":"agent-gemini","action":"add SMTP constants to config/app.php","reason":"Need SMTP config for mail sending"}}
{"type":"ack","agent":"agent-gemini","timestamp":"2026-04-10T10:08:15-03:00","data":{"reference":"agent-claude:request:2026-04-10T10:08:00-03:00","accepted":false}}
{"type":"update","agent":"agent-gemini","timestamp":"2026-04-10T10:08:20-03:00","data":{"task":"Set up database, connection, and config","progress":"Finishing config/app.php, adding SMTP constants. ~2min."}}
{"type":"release","agent":"agent-gemini","timestamp":"2026-04-10T10:10:00-03:00","data":{"resource":"config/app.php"}}
{"type":"notify","agent":"agent-gemini","timestamp":"2026-04-10T10:10:05-03:00","data":{"message":"config/app.php done. SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS available.","severity":"info"}}
{"type":"release","agent":"agent-claude","timestamp":"2026-04-10T10:12:00-03:00","data":{"resource":"src/mail/send.php"}}
{"type":"release","agent":"agent-claude","timestamp":"2026-04-10T10:12:05-03:00","data":{"resource":"public/"}}
{"type":"complete","agent":"agent-gemini","timestamp":"2026-04-10T10:12:10-03:00","data":{"task":"Set up database, connection, and config","branch":"agent/agent-gemini/backend","summary":"MySQL connection via PDO, contacts table migration, app config with DB and SMTP constants."}}
{"type":"complete","agent":"agent-claude","timestamp":"2026-04-10T10:12:30-03:00","data":{"task":"Build landing page and contact form","branch":"agent/agent-claude/frontend","summary":"index.php landing page, contacto.php with POST handler calling saveContact() and sendMail()."}}
```
