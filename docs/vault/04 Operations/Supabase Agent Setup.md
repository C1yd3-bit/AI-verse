# Supabase agent setup

[[Home]] · [[04 Operations/Runbook|Runbook]] · [[04 Operations/Cloudflare Agent Setup|Cloudflare agent setup]]

## Completed on 2026-10-24

The user supplied a project-scoped Supabase MCP URL and requested registration, authentication, verification and optional official skills. Registered global Codex MCP server `supabase` with the exact requested endpoint:

```text
https://mcp.supabase.com/mcp?project_ref=YOUR_SUPABASE_PROJECT_REF&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching
```

`codex mcp add` automatically started OAuth and reported successful login, so a second login was unnecessary. The verification used `codex mcp list --json`, printing only safe fields: server enabled, exact requested URL match and `auth_status: o_auth`. Existing Codex configuration, including Cloudflare, was preserved; absent versus empty command-argument arrays were treated as equivalent. A private pre-change backup remains in the task work directory.

Installed the optional official skills using `npx -y skills add supabase/agent-skills --yes --agent codex` from the AIVerse project. Both skill files exist:

- `.agents/skills/supabase/SKILL.md`
- `.agents/skills/supabase-postgres-best-practices/SKILL.md`

`skills-lock.json` records the installation. The installation is project-scoped; invoke Codex in this project to use its local skill discovery.

## Activation and boundaries

Restart Codex to load the new server, then `/mcp` can display its connection in the interactive client. CLI registration and OAuth status were verified; the new server's tools are not exposed in this current session, so no database/tool query is claimed.

This setup authorizes the agent connection specified by the user. It does not migrate the hosted project, alter tables or accounts, deploy Edge Functions, or change the application's `.env.local`. The running AIVerse app retains its existing isolated local Supabase configuration. Hosted identity, application credentials, schema/data verification and provider/release checks remain separate work.

Sources: [Supabase MCP documentation](https://supabase.com/docs/guides/ai-tools/mcp), [official skills repository](https://github.com/supabase/agent-skills).
