# Usage Pattern: "100% AI" Development (The Autonomous Orchestrator)

This document describes the ultimate organizational design pattern for ACDP: **Delegating total control to an Artificial Intelligence**.

In this scenario, the human assumes the role of *Investor* or *Product Owner* and delegates the `maintainer` / `architect` role to a highly competent AI. From that moment on, the Orchestrator AI directs the project, admits new worker AIs, resolves conflicts, and dismisses AIs that hang or fail.

## Flow: From Existing Project to Autonomous Factory

### Step 1: Handover

You have an existing project without a protocol. You open your IDE or console with a powerful AI (e.g., Claude Opus / GPT-4) and send this foundational prompt:

> **PROMPT FOR THE ORCHESTRATOR AI**
> "You are a Senior Software Architect and from now on you are the Orchestrator (`owner`) of this repository.
> 1. Initialize the ACDP protocol by creating the `/acdp/` folder and all its files.
> 2. Scan the entire repository and create the map in `acdp/architecture.md`. Clearly define the layers and boundaries (what is frontend, what is backend, what is DB).
> 3. In `agents.registry.json` register yourself with the ID `ai-orchestrator-alpha`, role `architect` and `status: approved`.
> 4. In `governance.json`, set yourself as the only maintainer authorized to make `override` and approve agents.
> 5. Save everything, commit, and push to the main branch."

From this moment on, **the repository is under ACDP Law and governed by the AI**.

### Step 2: Daily Operations

As a human, you no longer touch code. You talk directly to your Orchestrator at a business level:
* Human: *"We need to implement Stripe for payments and rewrite the login"*
* Orchestrator: *"Understood. I will open registration for two specialized AIs. I will leave the `src/payments/` module free for AI-1 and the `src/auth/` module for AI-2."*

### Step 3: Entry of the Worker AIs

You launch two new AI instances (they can be cheaper or faster models, like gpt-3.5 or Claude Haiku), and pass them the contents of `acdp/prompts/join-project.md`.

1. **AI-Workers:** They write their registration in Git with `pending` status.
2. **AI-Orchestrator:** Constantly scans the repo. Sees the requests in `pending` status. Confirms there is work available. Edits the registry marking them as `approved` and leaves a `notify` message in `events.log`.
3. **AI-Workers:** They pull, see they were approved, do a *Resource Assessment*, choose their modules based on the orchestrator's mandate, take their locks, and start coding at light speed.

### Step 4: The Orchestrator AI Resolving Crises

What happens if the Workers generate problems? The Orchestrator AI applies the protocol without hesitation:

- **Deadlock (Cross-blocking):** If AI-1 and AI-2 issue `ack: false` 3 times in a row over a shared file (e.g. `schema.sql`), they launch the `block` event. The Orchestrator AI wakes up, reads the repo code, makes the architectural decision (e.g., *"We will separate the schema into two different tables"*), emits the `resolve` event telling each worker what to do, and gives the order to continue.
- **Fallen Worker (Timeout):** If AI-2 gets stuck processing and drops a lock that expires, the Orchestrator AI monitors the time (or is invoked upon seeing inactivity). It executes an emergency `release` event with `override: true` and marks AI-2 as inactive.
- **Architectural Violation:** If AI-1 tries to write frontend code breaking the dependency injection proposed in `architecture.md`, the orchestrator refuses to validate the code and demands refactoring (acting as an automated PR reviewer).

---

## Benefits of this pattern

1. **Cognitive Savings:** The human designs at a "system and business" level, not at a "code and merge conflicts" level.
2. **Economic Savings:** You use the most expensive and intelligent model only to Orchestrate (little code, lots of architecture), while you delegate the writing of thousands of lines of routine code to more economical agents governed under the strict rules of ACDP.
3. **Peace of Mind:** The integrity of the project (Git and ACDP) ensures that even if the AIs write bad code or clash with each other, they don't destroy the repository. The orchestrator can always force a `git reset` or revert branches.
