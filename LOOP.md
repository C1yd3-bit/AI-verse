# AIVerse engineering loop

paused: false

Read STATE.md before each tick. Implement the smallest coherent unchecked acceptance item, verify it, record evidence, and repeat. Parent owns scope and final acceptance; loop-builder implements; loop-verifier independently accepts or rejects. A reject stays open until corrected and verified.

Use Impeccable for UI: preserve PRODUCT.md, respect the supplied visual brief, obtain the selected comp before UI implementation, document direction and design tokens, inspect desktop/mobile in a bounded pass, and use an independent finish review.

## Gates
No remote deployment, billing, account registration, production data changes, commits or pushes without explicit authorization. Local tooling, dependency installation, placeholder environment files and local development are authorized by the current request. Never put credentials in chat, logs, source or the vault. Do not modify unrelated projects.

The parent may create ignored local environment files and .env.example because environment setup was explicitly requested. Subagents do not edit environment files. Missing provider credentials use explicit demo mode; no claim of live integration or executed database tests without evidence.

## Cadence and stop
One current slice at a time. Run typecheck, lint, meaningful tests, production build and relevant runtime checks. Correct failures and rerun affected checks. Stop at accepted slice with the next slice documented, or a concrete credential/approval blocker. User can set paused: true to stop future work. No recurring automation is configured.
