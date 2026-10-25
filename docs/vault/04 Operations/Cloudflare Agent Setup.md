# Cloudflare agent setup

[[Home]] · [[04 Operations/Runbook|Runbook]] · [[03 Delivery/Release Checklist|Release checklist]]

## Completed on 2026-10-24

The user explicitly requested fetching and executing the appropriate instructions from [Cloudflare's agent setup prompt](https://developers.cloudflare.com/agent-setup/prompt.md). The Codex section applied to this desktop environment. This setup adds agent capabilities; it does not activate Stream billing or complete the application's provider integration.

- Ran the official `npx -y skills add cloudflare/skills --skill '*' --yes --global` command. All nineteen skills were installed under `<user-home>\.agents\skills`, the user skill directory supported by Codex. Every installed skill's `SKILL.md` was independently checked for existence by the parent. The installer also attempted its generic multi-agent destinations; its PromptScript global-install warnings do not affect the verified shared Codex location.
- Registered `cloudflare` with the Streamable HTTP URL `https://mcp.cloudflare.com/mcp` using `codex mcp add cloudflare --url https://mcp.cloudflare.com/mcp`. Codex started OAuth automatically and reported successful login. `codex mcp list --json`, with only safe Cloudflare fields printed, confirmed enabled configuration and `o_auth` status.
- Saved a private configuration backup in the task's work directory before registration. Existing configuration was compared semantically; absent versus empty command-argument arrays are equivalent. No original MCP entry was intentionally replaced.
- The user chose to skip the optional beta `cf` CLI. It was not installed and no user-level instruction preferring it was added. The official all-skills bundle includes a `cf-cli` instruction folder; that folder is not the executable.

## Activation and limits

Restart Codex to load the newly registered MCP server in the next session. New skills are available on the next turn; restart if discovery has not refreshed. Current-session tools do not yet expose the new Cloudflare server, so no MCP tool invocation or account-resource query is claimed.

OAuth used Cloudflare's standard authorization flow. No narrower re-authorization was completed. Tokens remain in Codex's credential storage; they were not copied into source, the vault or application environment files. A successful agent OAuth connection is distinct from the server-side `CLOUDFLARE_STREAM_API_TOKEN` expected by AIVerse's existing adapter.

Stream subscription/billing, application API credentials, a reachable test webhook, licensed test media and real upload/playback/deletion checks remain separate gates. No Cloudflare resource, subscription, tunnel, deployment or application environment setting was changed by this setup.

Sources: [Cloudflare setup](https://developers.cloudflare.com/agent-setup/), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Codex local skill locations](https://learn.chatgpt.com/docs/build-skills).
