# Agent workflow

[[Home]] · [[03 Delivery/Roadmap|Roadmap]] · [[03 Delivery/Build Log|Build log]]

## Loop Engineering
The parent reads root `AGENTS.md`, `PRODUCT.md`, `LOOP.md`, `STATE.md` and the relevant vault decision, then selects the smallest coherent unchecked acceptance item. It dispatches a bounded implementation to `loop-builder`, obtains independent evidence from `loop-verifier`, fixes rejected items and repeats. Only the parent updates final acceptance. `paused: true` in `LOOP.md` stops work.

Local setup and placeholder environment files are authorized by the user's environment request. The parent owns environment edits; delegated agents leave `.env*` alone. External billing, account registration, deployment, real email, production changes and unattended commits/pushes remain explicit gates.

## Impeccable
Use `PRODUCT.md` for product truth, `DESIGN.md` and `.impeccable/design.json` for visual tokens, and the surface brief/approved mockup for composition. This user chose an image mockup before code. A generated image alone is not proof of approval.

The designer runs the skill context workflow, chooses the relevant surface mode, records the direction and applies the craft floor before UI edits. Inspect desktop/mobile together, batch fixes and confirm with at most one more visual round. Independent finish review remains separate from implementation acceptance. Do not confuse this bounded polish pass with the engineering loop's obligation to resolve functional failures.

## Reusable roles
- `loop-builder`: one assigned implementation slice, with changed files, checks and limitations. Never declares the parent goal complete.
- `loop-verifier`: independent read/test review, reports ACCEPT or REJECT by criterion with reproducible evidence. No feature implementation.
- `impeccable-designer`: product-aware visual direction, image-first concept, tokens, accessible UI and bounded visual review.

Definitions live in project `.cursor/agents/*.md`, with identical `.agents/agents/*.md` copies for portability. This Codex session dispatches the roles explicitly through its agent tools using those protocols. Their presence does not prove another app automatically discovers or loads them. When editing a role, update both copies and compare their bytes.

## Handoff format
State the assigned criterion and owned paths, summarize the change, list actual commands/results, describe unverified behavior and blockers, then name the next smallest step. Do not include credentials or invent tests. Evidence lands in root `STATE.md` and [[03 Delivery/Build Log]].
