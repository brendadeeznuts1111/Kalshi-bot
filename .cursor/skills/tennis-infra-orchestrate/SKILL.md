---
name: tennis-infra-orchestrate
description: >-
  Launch parallel Cursor subagents for Kalshi-bot tennis infra: defect-first
  review then deep integration (or both at once). Use when the user says
  setup/run tennis subagents, /tennis-orchestrate, review and integrate tennis
  pipes, or wants multi-agent coverage of event-store + live + bridge + record.
disable-model-invocation: true
---

# Tennis infra orchestrate

Parent agent skill. Spawns specialized Task subagents; does not re-implement their work in the parent thread except to merge results and apply integration patches if the integrate agent was not given write scope.

## When invoked

1. Confirm workspace: `/Users/nolarose/Projects/Kalshi-bot` (or repo root).
2. `git status -sb` — note dirty lanes; tell subagents to touch **only** tennis paths.
3. Launch **two** Task subagents in **one** message (parallel):

### A) Review (read-only)

- `subagent_type`: `generalPurpose` or explore+generalPurpose
- `model`: inherit unless user named one
- `description`: `Tennis infra review`
- Prompt must include:
  - Full text instructions from `.cursor/skills/tennis-infra-review/SKILL.md`
  - "Return findings in the skill output format. Repo root: …"
  - Current dirty file list for the tennis lane

### B) Integrate (write)

- `subagent_type`: `generalPurpose`
- `description`: `Tennis infra integrate`
- Prompt must include:
  - Full text instructions from `.cursor/skills/tennis-infra-integrate/SKILL.md`
  - "Implement required integration work. Do not commit."
  - "If review findings exist in parallel, prefer watch-set + bridge-after-sync first; leave P0 fixes if obvious."

Optional third (only if user asks security):

- Follow `review-security` skill; scope tennis lane only.

## After subagents return

1. Paste a short merged summary for the user:
   - Review: P0/P1 count + top findings
   - Integrate: what landed (files + commands)
2. Run the verify test block from the integrate skill in the parent if the integrate agent did not.
3. Do **not** commit unless asked.
4. Offer next: WS writer, or commit.

## Anti-patterns

- Do not serialize review→integrate unless user wants review-only first.
- Do not let integrate touch `src/research/cli.ts` or NBA/MLB alpha.
- Do not re-clone ghost-trader patterns that violate UUID identity / unlabeled clocks.
