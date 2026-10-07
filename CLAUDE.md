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
- `data/app-confirmed.json` — hand-maintained facts from building scripts in the Jellycuts app; they override the docs and the compiler. Add an entry only with a console result, and add the script plus the console's error lines to `test/fixtures/app-console/` and `test/app-console.test.ts`.

## Jelly facts that drive the design
- Evidence order: the Jellycuts app's console > docs (2026, names/labels/optional flags) > the open-source compiler (2024), which lags the app. Nothing outside the iPhone can run the real compiler, so ask the user to build a small test file when a rule is unknown.
- Labels are required; time spans are quoted (`"10 min"`).
- Enum values are the real Shortcuts spellings, spaces included and unquoted (`property: File Extension`). The compiler's Swift case names (`FileExtension`) fail in the app with "The variable FileExtension does not exist in the scope"; the catalog keeps them as aliases so the validator can name the fix.
- JSON parameters are bare braces, never a quoted string ("Unable to find valid JSON"): `dictionary(json: {"a": "b"})` takes plain quotes, `downloadURL` `headers:` takes escaped quotes `{\"a\": \"b\"}` and goes last. No variables inside JSON; fill a dictionary with `setValue` instead.
- `&&`/`||` in `if` compile to the wrong condition; `if (…)` and `menu("…")` with parentheses fail in the open-source grammar — recommend the paren-free forms.
- Shared scripts live in the URL fragment (deflate-raw + base64url); nothing is stored server-side.
