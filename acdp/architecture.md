# Project Architecture

**Last updated:** 2026-04-10
**Maintained by:** project-owner

## Module Map

```
project/
├── acdp/                  # Coordination protocol (restricted)
├── src/
│   ├── frontend/          # Client-side application
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Route-level views
│   │   ├── hooks/         # Shared hooks and state logic
│   │   └── styles/        # Global styles and design tokens
│   ├── api/               # REST/GraphQL API layer
│   │   ├── routes/        # Endpoint definitions
│   │   ├── middleware/    # Auth, validation, logging
│   │   └── controllers/  # Request handlers
│   ├── auth/              # Authentication and authorization
│   │   ├── providers/     # OAuth, JWT, session strategies
│   │   └── guards/        # Permission checks
│   ├── db/                # Database layer
│   │   ├── migrations/    # Schema migrations
│   │   ├── models/        # Data models / entities
│   │   └── seeds/         # Seed data
│   └── shared/            # Cross-module utilities
│       ├── types/         # Shared type definitions
│       ├── utils/         # Helper functions
│       └── constants/     # Configuration constants
├── tests/                 # Test suites
├── scripts/               # Build, deploy, CI scripts
└── docs/                  # Project documentation
```

---

## Module Boundaries

Each module is a self-contained unit. Cross-module imports MUST go through the module's public API (index/barrel file).

| Module       | Public API              | Internal (do not import directly) |
|--------------|-------------------------|-----------------------------------|
| `frontend`   | `components/index.ts`   | Individual component files        |
| `api`        | `routes/index.ts`       | Controllers, middleware internals |
| `auth`       | `auth/index.ts`         | Provider implementations          |
| `db`         | `models/index.ts`       | Migrations, seeds                 |
| `shared`     | `shared/index.ts`       | All files are public              |

---

## Ownership Rules

Ownership determines who can approve changes to a module. This does NOT restrict who can work on it — only who must review.

| Module     | Owner            | Reviewers                     |
|------------|------------------|-------------------------------|
| `frontend` | agent-alpha      | agent-beta, project-owner     |
| `api`      | agent-beta       | agent-alpha, project-owner    |
| `auth`     | project-owner    | agent-alpha, agent-beta       |
| `db`       | project-owner    | agent-beta                    |
| `shared`   | project-owner    | agent-alpha, agent-beta       |
| `acdp/`    | project-owner    | —                             |

---

## Restricted Areas

These paths require maintainer approval for ANY change, regardless of locks:

| Path                  | Reason                                         |
|-----------------------|------------------------------------------------|
| `acdp/`               | Protocol files — governs coordination itself   |
| `acdp/governance.json` | Escalation and authority rules                |
| `src/auth/`           | Security-critical — must be reviewed           |
| `src/db/migrations/`  | Schema changes affect all modules              |
| `.env*`               | Secrets and environment configuration          |
| `scripts/deploy*`     | Production deployment scripts                  |

---

## Coordination Rules Between Modules

### 1. API ↔ Database

- API controllers MUST access data through models only — no raw queries.
- Schema migrations require a lock on BOTH `db/migrations/` and `api/routes/` if endpoints are affected.
- The `db` module owner must approve all migration PRs.

### 2. Frontend ↔ API

- Frontend consumes API through a typed client generated from API route definitions.
- If an API route signature changes, the agent MUST also update the frontend client.
- Lock both `api/routes/<affected-route>` and `frontend/hooks/<affected-hook>` when changing contracts.

### 3. Auth ↔ Everything

- Auth is a cross-cutting concern. Changes to auth guards may affect all modules.
- Any change to `auth/guards/` requires notification to all active agents via `events.log`.
- Auth changes are always reviewed by `project-owner`.

### 4. Shared ↔ Everything

- `shared/` is a dependency for all modules. Changes here have broad impact.
- Lock acquisition on `shared/` triggers an `INTENT_DECLARED` notification to all active agents.
- Breaking changes to shared types require ALL dependent module owners to acknowledge.

---

## Dependency Flow

```
frontend → api → auth → db
    ↓        ↓      ↓     ↓
    └────────┴──────┴─────┘
              shared
```

No circular dependencies allowed. If module A depends on module B, then B MUST NOT depend on A.
