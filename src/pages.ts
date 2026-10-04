// HTML pages served by the Worker. Self-contained (no external scripts or fonts) and
// designed for a phone screen first.

const APP_STORE = "https://apps.apple.com/app/jellycuts/id1522625245";
const DOCS = "https://docs.jellycuts.com";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE = `
:root {
  --bg: #f6f5fb; --card: #ffffff; --text: #1d1b26; --muted: #6b6878; --line: #e4e1ee;
  --accent: #7c4dff; --accent-text: #ffffff; --accent-soft: #efe9ff; --ok: #1f9d55; --code-bg: #f3f1f9;
  --kw: #a2238d; --str: #b3541e; --num: #1c6dd0; --fn: #5b3fd1; --cm: #8a8797; --label: #0f7b6c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12111a; --card: #1c1a26; --text: #f1eff8; --muted: #a29fb3; --line: #2e2b3b;
    --accent: #a98bff; --accent-text: #14121c; --accent-soft: #2a2440; --ok: #4cd287; --code-bg: #15131e;
    --kw: #ff7ad9; --str: #ffb36b; --num: #7cb8ff; --fn: #c3b1ff; --cm: #7f7b90; --label: #5ad1bd;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 20px 16px 48px; }
h1 { font-size: 1.6rem; line-height: 1.2; margin: 8px 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 1.05rem; margin: 0 0 8px; }
p { margin: 0 0 10px; }
a { color: var(--accent); }
.muted { color: var(--muted); font-size: 0.92rem; }
.brand { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 0.9rem; font-weight: 600; }
.brand .logo { width: 30px; height: 30px; border-radius: 8px; background: var(--accent-soft); display: grid; place-items: center; font-size: 18px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin: 14px 0; }
.steps { counter-reset: step; list-style: none; padding: 0; margin: 0; }
.steps li { counter-increment: step; position: relative; padding: 2px 0 14px 40px; }
.steps li:last-child { padding-bottom: 0; }
.steps li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 28px; height: 28px; border-radius: 50%;
  background: var(--accent-soft); color: var(--accent); font-weight: 700; display: grid; place-items: center; font-size: 0.9rem; }
.btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 52px; padding: 12px 16px;
  border-radius: 14px; border: 0; font: inherit; font-weight: 650; font-size: 1.05rem; text-decoration: none; cursor: pointer;
  background: var(--accent); color: var(--accent-text); -webkit-tap-highlight-color: transparent; }
.btn:active { transform: scale(0.985); }
.btn.secondary { background: var(--accent-soft); color: var(--accent); }
.btn.done { background: var(--ok); color: #fff; }
.row { display: grid; gap: 10px; margin-top: 10px; }
@media (min-width: 560px) { .row.two { grid-template-columns: 1fr 1fr; } }
.url { font: 0.95rem ui-monospace, "SF Mono", Menlo, monospace; background: var(--code-bg); border: 1px solid var(--line);
  border-radius: 12px; padding: 12px; word-break: break-all; user-select: all; -webkit-user-select: all; }
pre.code { margin: 0; background: var(--code-bg); border: 1px solid var(--line); border-radius: 12px; overflow-x: auto;
  font: 13px/1.55 ui-monospace, "SF Mono", Menlo, monospace; padding: 12px 0; -webkit-overflow-scrolling: touch; }
pre.code .ln { display: block; padding: 0 14px 0 0; white-space: pre; counter-increment: ln; }
pre.code .ln::before { content: counter(ln); display: inline-block; width: 2.6em; padding-right: 0.9em; text-align: right;
  color: var(--cm); user-select: none; -webkit-user-select: none; }
pre.code { counter-reset: ln; }
pre.code.wrap .ln { white-space: pre-wrap; padding-left: 3.5em; text-indent: -3.5em; }
.k { color: var(--kw); font-weight: 600; } .s { color: var(--str); } .n { color: var(--num); } .f { color: var(--fn); }
.c { color: var(--cm); font-style: italic; } .l { color: var(--label); }
.code-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.link-btn { background: none; border: 0; color: var(--accent); font: inherit; font-size: 0.92rem; padding: 6px 0; cursor: pointer; }
.error { border-color: #d64545; }
footer { margin-top: 28px; text-align: center; }
code.inline { font: 0.92em ui-monospace, "SF Mono", Menlo, monospace; background: var(--code-bg); padding: 1px 5px; border-radius: 6px; }
`;

function page(title: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🪼</text></svg>">
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
${script ? `<script>${script}</script>` : ""}
</body>
</html>`;
}

// Shared by both pages: copy text to the clipboard with a fallback for older Safari.
const COPY_JS = `
async function copyText(text, button, label) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    document.execCommand("copy"); ta.remove();
  }
  button.classList.add("done"); button.textContent = "✓ Copied";
  setTimeout(() => { button.classList.remove("done"); button.textContent = label; }, 2200);
}`;

export function homePage(origin: string): string {
  const mcpUrl = `${origin}/mcp`;
  return page(
    "Jellycuts connector for Claude",
    `
<div class="brand"><span class="logo">🪼</span> Jellycuts × Claude</div>
<h1>Your Jellycuts connector is running</h1>
<p class="muted">Claude can now look up Jelly actions, check scripts and send you install links for new iPhone Shortcuts.</p>

<section class="card">
  <h2>Your connector URL</h2>
  <div class="url" id="mcp-url">${escapeHtml(mcpUrl)}</div>
  <div class="row"><button class="btn" id="copy-url">Copy connector URL</button></div>
</section>

<section class="card">
  <h2>Add it to Claude (one time)</h2>
  <ol class="steps">
    <li>In the Claude app open <b>Settings → Connectors → Add custom connector</b>.</li>
    <li><b>Name:</b> Jellycuts &nbsp;·&nbsp; <b>URL:</b> paste the URL above.</li>
    <li>Leave <b>Requires sign-in</b> off and tap <b>✓</b> to save.</li>
    <li>In a chat, make sure the Jellycuts connector is switched on (tools menu), then ask for a shortcut.</li>
  </ol>
</section>

<section class="card">
  <h2>Things to ask Claude</h2>
  <p>“Make me a shortcut that turns on Low Power Mode and tells me my battery level.”</p>
  <p>“Build a shortcut that asks what I drank and logs it with the time.”</p>
  <p class="muted">You also need the <a href="${APP_STORE}">Jellycuts app</a> — it turns Claude's code into a real shortcut.</p>
</section>

<footer class="muted">Language reference: <a href="${DOCS}">docs.jellycuts.com</a></footer>
`,
    `${COPY_JS}
const btn = document.getElementById("copy-url");
btn.addEventListener("click", () => copyText(${JSON.stringify(mcpUrl)}, btn, "Copy connector URL"));`,
  );
}

export function installPage(): string {
  return page(
    "Install shortcut · Jellycuts",
    `
<div class="brand"><span class="logo">🪼</span> Jellycuts × Claude</div>
<h1 id="title">Loading your shortcut…</h1>
<p class="muted" id="subtitle">&nbsp;</p>

<section class="card" id="error-card" hidden>
  <h2>This link didn't open</h2>
  <p id="error-text">The script is stored inside the link itself, and this one looks incomplete.</p>
  <p class="muted">Ask Claude to share the shortcut again, or to paste the code into the chat.</p>
</section>

<div id="content" hidden>
  <section class="card">
    <ol class="steps">
      <li><b>Copy the code.</b>
        <div class="row"><button class="btn" id="copy">Copy code</button></div>
      </li>
      <li><b>Open Jellycuts</b> and create a new Jellycut<span id="name-hint"></span>.
        <div class="row"><a class="btn secondary" href="jellycuts://">Open Jellycuts</a></div>
        <p class="muted" style="margin-top:8px">Not installed? <a href="${APP_STORE}">Get Jellycuts on the App Store</a>.</p>
      </li>
      <li><b>Paste:</b> select all of the starter text in the new Jellycut and paste over it.</li>
      <li><b>Build / export</b> it to Shortcuts, then tap <b>Add Shortcut</b>. If Jellycuts shows an error, send it to Claude.</li>
    </ol>
  </section>

  <section class="card">
    <div class="code-head">
      <h2 style="margin:0">Code</h2>
      <button class="link-btn" id="wrap">Wrap lines</button>
    </div>
    <pre class="code" id="code"></pre>
    <div class="row two">
      <button class="btn secondary" id="download">Download .jelly file</button>
      <button class="btn secondary" id="share" hidden>Share file…</button>
    </div>
  </section>
  <p class="muted" style="text-align:center">Nothing is stored on a server — the whole script lives inside this link.</p>
</div>
`,
    `${COPY_JS}
const $ = (id) => document.getElementById(id);
function fail(message) {
  $("title").textContent = "Couldn't open this shortcut";
  if (message) $("error-text").textContent = message;
  $("error-card").hidden = false;
}
async function decode(token) {
  if (!token.startsWith("v1.")) throw new Error("This link format isn't recognised.");
  if (typeof DecompressionStream === "undefined") throw new Error("This browser is too old to open the link (needs iOS 16.4 or newer).");
  const b64 = token.slice(3).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const data = JSON.parse(await new Response(stream).text());
  if (typeof data.n !== "string" || typeof data.c !== "string") throw new Error("The link is damaged.");
  return { name: data.n, code: data.c };
}
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const KEYWORDS = new Set(["import","var","if","else","repeat","repeatEach","menu","case","func","macro","return","nil","true","false"]);
function highlightLine(line, state) {
  // state.ml: inside a """ multi-line string
  let out = "", i = 0;
  while (i < line.length) {
    if (state.ml) {
      const end = line.indexOf('"""', i);
      const stop = end === -1 ? line.length : end + 3;
      out += '<span class="s">' + esc(line.slice(i, stop)) + "</span>";
      if (end !== -1) state.ml = false;
      i = stop; continue;
    }
    const rest = line.slice(i);
    let m;
    if (rest.startsWith("//")) { out += '<span class="c">' + esc(rest) + "</span>"; break; }
    if (rest.startsWith('"""')) { state.ml = true; out += '<span class="s">"""</span>'; i += 3; continue; }
    if ((m = /^"(?:\\\\.|[^"\\\\])*"?/.exec(rest))) { out += '<span class="s">' + esc(m[0]) + "</span>"; i += m[0].length; continue; }
    if ((m = /^#(Color|Icon)\\b/.exec(rest))) { out += '<span class="k">' + m[0] + "</span>"; i += m[0].length; continue; }
    if ((m = /^\\d+(\\.\\d+)?/.exec(rest))) { out += '<span class="n">' + m[0] + "</span>"; i += m[0].length; continue; }
    if ((m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(rest))) {
      const w = m[0], after = rest.slice(w.length);
      const cls = KEYWORDS.has(w) ? "k" : /^\\s*\\(/.test(after) ? "f" : /^\\s*:(?!:)/.test(after) ? "l" : "";
      out += cls ? '<span class="' + cls + '">' + w + "</span>" : w;
      i += w.length; continue;
    }
    out += esc(line[i]); i++;
  }
  return out;
}
function render(code) {
  const state = { ml: false };
  $("code").innerHTML = code.split("\\n").map((l) => '<span class="ln">' + (highlightLine(l, state) || " ") + "</span>").join("");
}
(async () => {
  const token = decodeURIComponent(location.hash.slice(1));
  if (!token) return fail("This link has no script in it.");
  let script;
  try { script = await decode(token); } catch (e) { return fail(e && e.message); }
  const lines = script.code.split("\\n").length;
  document.title = script.name + " · Install with Jellycuts";
  $("title").textContent = script.name;
  $("subtitle").textContent = "Jelly script · " + lines + " line" + (lines === 1 ? "" : "s");
  $("name-hint").textContent = " named “" + script.name + "”";
  render(script.code);
  $("content").hidden = false;
  const copy = $("copy");
  copy.addEventListener("click", () => copyText(script.code, copy, "Copy code"));
  $("wrap").addEventListener("click", () => {
    const pre = $("code"); pre.classList.toggle("wrap");
    $("wrap").textContent = pre.classList.contains("wrap") ? "Don't wrap" : "Wrap lines";
  });
  const fileName = (script.name.replace(/[\\\\/:*?"<>|]+/g, " ").trim() || "Shortcut") + ".jelly";
  const makeFile = () => new File([script.code], fileName, { type: "text/plain" });
  $("download").addEventListener("click", () => {
    const url = URL.createObjectURL(makeFile());
    const a = document.createElement("a"); a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  try {
    if (navigator.canShare && navigator.canShare({ files: [makeFile()] })) {
      const share = $("share"); share.hidden = false;
      share.addEventListener("click", () => navigator.share({ files: [makeFile()], title: script.name }).catch(() => {}));
    }
  } catch (e) {}
})();`,
  );
}
