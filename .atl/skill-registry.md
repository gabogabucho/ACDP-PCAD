# Skill Registry — ACDP-PCAD

Generated: 2026-04-11

## Compact Rules

### branch-pr
- Always open an issue first before creating a PR
- Use conventional commits in PR title
- Reference the issue in the PR body

### sdd-apply
- Follow existing JS style (CommonJS, no TypeScript)
- No breaking changes to event schema without version bump
- Keep CLI commands backward compatible unless explicitly noted in spec

### judgment-day
- Use for high-risk changes to protocol.md, cli.js, lock-manager.js
- Run before any PR that modifies coordination logic

## User Skills

| Skill | Trigger context |
|-------|----------------|
| `branch-pr` | Creating PRs, preparing changes for review |
| `issue-creation` | Reporting bugs, requesting features |
| `sdd-explore` | Investigating before a change |
| `sdd-propose` | Writing a change proposal |
| `sdd-spec` | Writing specifications |
| `sdd-design` | Technical design documents |
| `sdd-tasks` | Breaking down implementation |
| `sdd-apply` | Implementing tasks |
| `sdd-verify` | Validating implementation vs specs |
| `sdd-archive` | Closing a completed change |
| `judgment-day` | Adversarial review of critical changes |
| `skill-creator` | Creating new agent skills |

## Project Conventions

- Source: `skills/_shared/engram-convention.md` (user-level)
- No project-level CLAUDE.md or AGENTS.md
- Protected files (from governance.json): `acdp/protocol.md`, `acdp/governance.json`, `acdp/architecture.md`
