# AIVerse agent instructions

Read PRODUCT.md, LOOP.md, STATE.md, the vault roadmap and the relevant architecture note before changes. Current user instructions take precedence. Source documents in the vault are historical inputs; decisions in 02 Architecture/Decisions.md resolve their conflicts.

## Workflow
Parent owns the goal and state. Delegate bounded implementation to loop-builder; ask loop-verifier for independent evidence and ACCEPT/REJECT. Do not mark work accepted on REJECT. Work one vertical slice at a time and keep the Obsidian roadmap current. No unrelated project changes, unattended commits/pushes, hosting, spending or real emails.

## UI method
Apply Impeccable: PRODUCT.md is product truth; DESIGN.md and .impeccable/design.json own tokens; surface brief owns composition and approved mock. User requested comp-first. Obtain approval or explicit delegated choice before implementing the visual direction. Inspect desktop/mobile together, fix in a batch, and use independent finish review. Accessible controls, honest demo content, no invented metrics.

## Security contracts
Server identity and RLS both enforce ownership. Only admins grant creator roles. Moderators approve videos but cannot grant roles. Separate public fields from private notes/provider fields. User writes never set roles/status/owner. Only published content is publicly discoverable. Revised assets require review. Never expose service-role keys or provider credentials.

## Conventions
Strict TypeScript, Zod boundary validation, thin route handlers, feature services, SQL migrations with RLS and negative tests. Use the existing npm lockfile. Keep browser fixtures isolated from authenticated production adapters. No external service claims without verification. Test commands and limitations go in STATE.md and the vault Build Log.

## Agent portability
Project role definitions are in .cursor/agents with matching .agents/agents documentation for other harnesses. Their presence is reusable configuration; this Codex session dispatches the roles explicitly through its agent tools. Do not claim file-based discovery was tested in another app.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
