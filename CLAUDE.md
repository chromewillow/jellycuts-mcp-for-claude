# Jellycuts MCP connector

Remote MCP server (Cloudflare Worker) that helps Claude write Jelly scripts for the Jellycuts iOS app and hand them to the user as install links. The owner works from an iPhone: keep setup steps phone-friendly and avoid anything that needs a laptop.

## Commands
- `npm test` — vitest (validator, catalog, share links, MCP protocol via the Worker's fetch handler)
- `npm run typecheck` — tsc
- `npm run dev` — wrangler dev on :8787 (MCP endpoint `/mcp`)
- `npm run build:catalog` — regenerate `data/catalog.json` from docs.jellycuts.com + Open-Jellycore (clones into `.cache/`)

## Layout
- `src/index.ts` routes: `/mcp` (stateless Streamable HTTP, JSON responses), `/s/<slug>#v1.<payload>` install page, `/` setup page, `/health`.
- `src/mcp.ts` tools: jelly_guide, search_actions, get_action, validate_jelly, share_jelly (+ server instructions).
- `src/jelly/lexer.ts`, `src/jelly/validate.ts` — conservative linter. "error" only for things that certainly break a build or silently drop a value; uncertain things are warnings, version-specific syntax is "info".
- `src/guide.ts` — language guide. Every ```jelly snippet must validate without errors (tested).
- `data/catalog.json` — generated; don't edit by hand.

## Jelly facts that drive the design
- Docs (2026) are the source of truth for action names/labels/optional flags; the open-source compiler (2024) lags the App Store app.
- Labels are required; enum values are bare case-sensitive words (`case: uppercase`); time spans are quoted (`"10 min"`); dictionaries are JSON inside an escaped string.
- `&&`/`||` in `if` compile to the wrong condition; `if (…)` and `menu("…")` with parentheses fail in the open-source grammar — recommend the paren-free forms.
- Shared scripts live in the URL fragment (deflate-raw + base64url); nothing is stored server-side.
