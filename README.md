# 🪼 Jellycuts connector for Claude

Build iPhone Shortcuts by chatting with Claude — no laptop needed.

You describe the shortcut you want. Claude writes it in **Jelly** (the scripting language of the [Jellycuts](https://apps.apple.com/app/jellycuts/id1522625245) app), checks it with this connector, and gives you a link. Tap the link, copy the code into Jellycuts, and Jellycuts turns it into a real shortcut.

```
You: "Make a shortcut that turns on Low Power Mode when my battery is under 20%"
        │
Claude ──► this connector: looks up the exact Jelly actions, checks the script for mistakes
        │
Claude: "Here's your install link" ──► tap ──► Copy code ──► Jellycuts ──► Add Shortcut ✅
```

## What you need

- The **Claude** app on your iPhone (with access to custom connectors — you'll see *Settings → Connectors → Add custom connector*)
- The **[Jellycuts](https://apps.apple.com/app/jellycuts/id1522625245)** app
- A free **[Cloudflare](https://dash.cloudflare.com/sign-up)** account (it hosts the connector)
- This repository on GitHub

## Set it up from your iPhone (about 10 minutes, one time)

### 1. Put the connector online with Cloudflare (free)

1. In Safari, open **[dash.cloudflare.com](https://dash.cloudflare.com)** and sign up or log in. (Tip: turn the phone sideways — the dashboard is roomier.)
2. Go to **Workers & Pages** → **Create** → **Import a repository** → **Get started**.
3. Connect your GitHub account when asked and pick **`jellycuts-mcp-for-claude`**.
4. Keep the project name **`jellycuts-mcp`** (it must match `wrangler.jsonc`) and leave the build settings as they are — the deploy command is `npx wrangler deploy`. Tap **Deploy**.
5. When it finishes, open the address it shows, e.g. `https://jellycuts-mcp.YOUR-NAME.workers.dev`. You should see **"Your Jellycuts connector is running"** and a **Copy connector URL** button.

From now on, every change pushed to this repo redeploys automatically.

### 2. Add the connector to Claude

1. In the Claude app open **Settings → Connectors → Add custom connector**.
2. **Name:** `Jellycuts`
3. **URL:** paste the connector URL — it ends in **`/mcp`**, e.g. `https://jellycuts-mcp.YOUR-NAME.workers.dev/mcp`
4. Leave **Requires sign-in** off and tap **✓**.

### 3. Make a shortcut

1. Start a new chat and make sure the **Jellycuts** connector is switched on in the chat's tools menu.
2. Ask for something, e.g. *"Make me a shortcut that asks what I drank and logs it with the time."*
3. Claude replies with an **install link**. Tap it, then:
   1. **Copy code**
   2. **Open Jellycuts** → create a new Jellycut (use the name Claude gave) → select all of its starter text → paste
   3. Build/export it to Shortcuts → **Add Shortcut**
4. If Jellycuts shows an error, screenshot it and send it to Claude — it will fix the script and send a new link.

## What Claude gets from the connector

| Tool | What it does |
| --- | --- |
| `jelly_guide` | A compact, up-to-date guide to the Jelly language: rules, syntax, recipes and known pitfalls. |
| `search_actions` | Finds the right action among the 640 documented ones ("send notification" → `sendNotification`). |
| `get_action` | Exact parameter labels, types, optional flags and allowed values for any action. |
| `validate_jelly` | Checks a script before you ever see it: unknown actions, wrong labels, invalid values, missing imports, unbalanced `{ }`, curly quotes from iOS Smart Punctuation, and more. |
| `share_jelly` | Turns a checked script into a phone-friendly install link with **Copy code** and **Open Jellycuts** buttons. |

## Good to know

- **Why the copy-and-paste step?** Apple only installs *signed* shortcuts, and Jellycuts does the compiling and signing on your phone. The connector makes sure the code you paste is right; Jellycuts does the last step.
- **The checker is careful, not perfect.** It knows every documented action and the common mistakes, but the Jellycuts app has the final say. Errors are almost always quick for Claude to fix.
- **Nothing is stored.** The connector has no database and no accounts. Your script lives inside the install link itself (after the `#`, which browsers never send to the server).
- **Your connector URL is public**, but there's nothing private behind it: it only serves Jelly documentation and checks code. Cloudflare's free plan allows 100,000 requests a day.
- **Third-party libraries** (Data Jar, Toolbox Pro, Scriptable, …) only work if you have that app installed. Claude prefers built-in actions.

## Keeping the action list fresh

The action catalog in `data/catalog.json` is generated from the official [Jellycuts docs](https://docs.jellycuts.com). To refresh it after the docs change, run `npm run build:catalog` on a computer (or ask Claude Code to do it) and push.

The docs don't cover everything the Jellycuts app checks, so `data/app-confirmed.json` records rules confirmed by building test scripts in the app (for example, which way to write JSON for each parameter). When the app reports an error the connector didn't catch, paste the whole console into a chat with Claude Code: the script and its console lines become a test in `test/fixtures/app-console/`, so the connector can't make that mistake again.

## For developers

```bash
npm install
npm run dev            # local server at http://localhost:8787 (MCP endpoint: /mcp)
npm test               # validator, catalog, share-link and MCP protocol tests
npm run typecheck
npm run deploy         # deploy with Wrangler from a computer
npm run build:catalog  # regenerate data/catalog.json from the docs
```

How it fits together:

- `src/index.ts` — Cloudflare Worker: `/mcp` (stateless Streamable HTTP MCP endpoint), `/s/…` install page, `/` setup page.
- `src/mcp.ts` — the MCP tools and the instructions Claude sees.
- `src/guide.ts` — the Jelly guide returned by `jelly_guide`.
- `src/jelly/` — a tolerant Jelly tokenizer and validator.
- `data/app-confirmed.json` + `test/app-console.test.ts` — rules confirmed in the Jellycuts app, and the scripts that prove them.
- `src/catalog.ts` + `data/catalog.json` — action lookup and search.
- `src/share.ts`, `src/pages.ts` — compressed share links and the HTML pages.

To try the endpoint with the MCP Inspector: `npx @modelcontextprotocol/inspector` and connect to `http://localhost:8787/mcp` (transport: Streamable HTTP).

## Credits

- Action names, parameters and descriptions come from the official Jellycuts documentation ([docs.jellycuts.com](https://docs.jellycuts.com), [source](https://github.com/Jellycuts/docs.jellycuts.com)).
- Enumeration values and several syntax details were checked against the open-source Jelly compiler [Open-Jellycore](https://github.com/OpenJelly/Open-Jellycore) (GPL-3.0).
- This is an independent project, not affiliated with Jellycuts or Anthropic.
