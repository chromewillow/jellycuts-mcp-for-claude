#!/usr/bin/env node
// Builds data/catalog.json: every Jelly action (function) Claude can call, with its
// parameters, types, optional flags, enum values and an example.
//
// Sources (cloned into .cache/ unless you pass paths):
//   - https://github.com/Jellycuts/docs.jellycuts.com  (official docs, generated from the
//     Jellycuts compiler; the source of truth for names, labels and optional flags)
//   - https://github.com/OpenJelly/Open-Jellycore      (open-source compiler; used only for
//     the allowed values of enumeration parameters, which the docs don't list)
//
// Usage:
//   npm run build:catalog
//   node scripts/build-catalog.mjs --docs ../docs.jellycuts.com --core ../Open-Jellycore

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function ensureRepo(url, dir) {
  if (existsSync(join(dir, ".git"))) {
    execFileSync("git", ["-C", dir, "pull", "--ff-only", "-q"], { stdio: "inherit" });
  } else {
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync("git", ["clone", "-q", "--depth", "1", url, dir], { stdio: "inherit" });
  }
  return dir;
}

const docsDir = argValue("--docs") ?? ensureRepo("https://github.com/Jellycuts/docs.jellycuts.com", join(root, ".cache/docs.jellycuts.com"));
const coreDir = argValue("--core") ?? ensureRepo("https://github.com/OpenJelly/Open-Jellycore", join(root, ".cache/Open-Jellycore"));

// Folder name under docs/Documentation -> the name used in `import X`.
const LIBRARIES = {
  Shortcuts: { import: "Shortcuts", title: "Shortcuts (built-in actions)", app: "Apple Shortcuts" },
  Actions: { import: "Actions", title: "Actions", app: "Actions by Sindre Sorhus" },
  Apollo: { import: "Apollo", title: "Apollo", app: "Apollo for Reddit" },
  CARROT: { import: "CARROT", title: "CARROT Weather", app: "CARROT Weather" },
  DataJar: { import: "DataJar", title: "Data Jar", app: "Data Jar" },
  Drafts: { import: "Drafts", title: "Drafts", app: "Drafts" },
  FocusedWork: { import: "FocusedWork", title: "Focused Work", app: "Focused Work" },
  GizmoPack: { import: "GizmoPack", title: "GizmoPack", app: "GizmoPack" },
  Jellycuts: { import: "Jellycuts", title: "Jellycuts", app: "Jellycuts" },
  LinkBin: { import: "LinkBin", title: "Link Bin", app: "Link Bin" },
  Nudget: { import: "Nudget", title: "Nudget", app: "Nudget" },
  OtterRSS: { import: "OtterRSS", title: "An Otter RSS", app: "An Otter RSS" },
  Progress: { import: "Progress", title: "Progress", app: "Progress" },
  Recurrence: { import: "Recurrence", title: "Recurrence", app: "Recurrence" },
  RoutineHubAds: { import: "RoutineHubAds", title: "RoutineHub Ads (Jellycuts Premium only)", app: "RoutineHub" },
  Rubyist: { import: "Rubyist", title: "Rubyist", app: "Rubyist" },
  Scriptable: { import: "Scriptable", title: "Scriptable", app: "Scriptable" },
  ToolboxPro: { import: "Toolbox", title: "Toolbox Pro", app: "Toolbox Pro" },
  WallpaperApp: { import: "WallpaperApp", title: "The Wallpaper App", app: "The Wallpaper App" },
  WidgetPack: { import: "WidgetPack", title: "WidgetPack", app: "WidgetPack" },
  aShell: { import: "aShell", title: "a-Shell", app: "a-Shell" },
  aShellMini: { import: "aShellMini", title: "a-Shell Mini", app: "a-Shell mini" },
};

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const tidy = (s) =>
  decode(s)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

/** Split "a: x, b: <#y, z#>" on top-level commas (ignores commas inside <# #>, quotes, brackets). */
function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === "\\") cur += s[++i] ?? "";
      else if (c === '"') quote = false;
      continue;
    }
    if (c === '"') quote = true;
    else if (s.startsWith("<#", i)) depth++;
    else if (s.startsWith("#>", i)) depth = Math.max(0, depth - 1);
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseParam(part) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]*)$/.exec(part);
  if (!m) return null;
  const [, name, rawType] = m;
  const placeholder = /<#([\s\S]*?)#>/.exec(rawType);
  const param = { name };
  if (!placeholder) {
    // Untyped in the docs (filters, some third-party actions) or a literal example.
    param.type = rawType.trim() ? "Literal" : "Unknown";
    return param;
  }
  let t = placeholder[1];
  if (/\(Optional\)/.test(t)) param.optional = true;
  if (/\(Allows Variables\)/.test(t)) param.allowsVariables = true;
  if (/\(No Variables\)/.test(t)) param.allowsVariables = false;
  t = t.replace(/\((Optional|Allows Variables|No Variables)\)/g, "").trim();
  const enumMatch = /^(Enumeration|Dynamic Enum)\s*\(([^)]+)\)$/.exec(t);
  const objectMatch = /^Object\s*\(([^)]+)\)$/.exec(t);
  const sortMatch = /^Sort\s*\(([^)]+)\)$/.exec(t);
  if (enumMatch) {
    param.type = enumMatch[1] === "Dynamic Enum" ? "DynamicEnum" : "Enum";
    param.enum = enumMatch[2].trim();
  } else if (objectMatch) {
    param.type = "Object";
    param.object = objectMatch[1].trim();
  } else if (sortMatch) {
    param.type = "Sort";
  } else {
    param.type = t;
  }
  return param;
}

function parseActionPage(html, library, file) {
  const title = tidy(/<div class="Main"[\s\S]*?<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");
  const badge = tidy(/<div class="iOSBadge"><p>([\s\S]*?)<\/p><\/div>/.exec(html)?.[1] ?? "");
  const notes = tidy(/<h2 id="notes">Notes<\/h2>([\s\S]*?)<h2/.exec(html)?.[1] ?? "");
  const syntax = tidy(/<h2 id="syntax">Syntax<\/h2>\s*<pre>\s*<code>([\s\S]*?)<\/code>/.exec(html)?.[1] ?? "");
  const example = decode(/<h2 id="example">Example<\/h2>\s*<pre>\s*<code>([\s\S]*?)<\/code>/.exec(html)?.[1] ?? "").trim();

  // The syntax line may be preceded by import lines; find "name(...)".
  const call = /([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*)\)\s*$/m.exec(syntax.split("\n").find((l) => /\w+\(/.test(l) && !l.startsWith("import")) ?? "");
  const name = call?.[1] ?? file.replace(/\.html$/, "");
  const params = [];
  const seen = new Set();
  for (const part of splitTopLevel(call?.[2] ?? "")) {
    const p = parseParam(part);
    if (p && !seen.has(p.name)) {
      seen.add(p.name);
      params.push(p);
    }
  }
  const minIOS = /iOS\s*(\d+)/.exec(badge)?.[1];
  const entry = {
    name,
    library,
    title,
    description: notes,
    params,
    syntax: syntax.split("\n").find((l) => l.startsWith(`${name}(`)) ?? syntax,
    example,
    doc: `https://docs.jellycuts.com/Documentation/${library}/${file}`,
  };
  if (minIOS) entry.minIOS = Number(minIOS);
  if (/premium/i.test(badge)) entry.premium = true;
  return entry;
}

// ---- Enumerations from Open-Jellycore -------------------------------------------------
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith(".swift")) out.push(p);
  }
  return out;
}

const enums = {};
const lookupDir = join(coreDir, "Sources/Open-Jellycore/Core/Compiler/Lookup Tables/Apps");
for (const file of walk(lookupDir)) {
  const src = readFileSync(file, "utf8");
  const m = /enum\s+Jelly_(\w+)\s*:\s*String[^{]*\{([\s\S]*?)(?:\n\s*(?:init|var|static|func)\b)/.exec(src);
  if (!m) continue;
  const values = [];
  for (const line of m[2].split("\n")) {
    const c = /^\s*case\s+(.+?)\s*$/.exec(line);
    if (!c) continue;
    for (const item of c[1].split(",")) {
      const v = /^`?(\w+)`?(?:\s*=\s*"([^"]*)")?$/.exec(item.trim());
      if (v) values.push(v[2] ?? v[1]);
    }
  }
  if (values.length) enums[m[1]] = values;
}

// ---- Actions from the docs -------------------------------------------------------------
const actions = [];
const docRoot = join(docsDir, "Documentation");
for (const folder of readdirSync(docRoot).sort()) {
  const lib = LIBRARIES[folder];
  if (!lib) {
    console.warn(`! Unknown library folder "${folder}" — add it to LIBRARIES in scripts/build-catalog.mjs`);
    continue;
  }
  for (const file of readdirSync(join(docRoot, folder)).sort()) {
    if (!file.endsWith(".html")) continue;
    const entry = parseActionPage(readFileSync(join(docRoot, folder, file), "utf8"), folder, file);
    entry.library = lib.import;
    actions.push(entry);
  }
}

// Same function documented in two places (e.g. Jellycuts helpers listed under Shortcuts): keep the first.
const byKey = new Map();
for (const a of actions) {
  const key = `${a.library}:${a.name}`;
  if (!byKey.has(key)) byKey.set(key, a);
}

const usedEnums = new Set();
for (const a of byKey.values()) for (const p of a.params) if (p.enum) usedEnums.add(p.enum);
const enumsOut = {};
for (const name of [...usedEnums].sort()) if (enums[name]) enumsOut[name] = enums[name];

// ---- Example clean-up ------------------------------------------------------------------
// Many generated examples predate Jelly 3 (spaces in names, display names for enum values)
// or were mangled by the docs generator (JSON). Rewrite what we safely can, drop the rest.
const V2_GLOBALS = [
  [/\bShortcut Input\b/g, "ShortcutInput"],
  [/\bCurrent Date\b/g, "CurrentDate"],
  [/\bRepeat Item\b/gi, "RepeatItem"],
  [/\bRepeat Index\b/gi, "RepeatIndex"],
];
const squash = (s) => s.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
// Hand-written examples for actions whose docs example is broken.
const EXAMPLE_OVERRIDES = {
  "Shortcuts:dictionary": 'dictionary(json: "{\\"name\\": \\"Ada\\", \\"age\\": 36}") >> person',
  "Shortcuts:list": 'list(items: ["Coffee", "Tea", "Water"]) >> drinks',
  "Shortcuts:downloadURL":
    'downloadURL(url: "https://httpbin.org/post", method: POST, headers: "{\\"Accept\\": \\"application/json\\"}", requestType: Json, requestJSON: "{\\"hello\\": \\"world\\"}") >> response',
  "Shortcuts:valueFor": 'valueFor(key: "name", dictionary: person) >> name',
};

function normalizeExample(action) {
  const override = EXAMPLE_OVERRIDES[`${action.library}:${action.name}`];
  if (override) return override;
  let ex = action.example;
  if (!ex || /[{[]\\|\\\)|:\s*\\\)/.test(ex)) return "";
  // Generator artefacts that aren't Jelly at all: doubled quotes, placeholder warnings and
  // Swift object dumps such as Draft(identifier: "…", …).
  if (/""""|(^|[^"])""[^"\s,)]|⚠️|\b[A-Z]\w*\(identifier:|Placemark\(|…/.test(ex)) return "";
  for (const [re, to] of V2_GLOBALS) ex = ex.replace(re, to);
  const call = new RegExp(`\\b${action.name}\\(([\\s\\S]*)\\)`).exec(ex);
  if (!call) return ex;
  const parts = splitTopLevel(call[1]).map((part) => {
    const m = /^([A-Za-z_]\w*)\s*:\s*([\s\S]*)$/.exec(part);
    if (!m) return part;
    const [, label, value] = m;
    const param = action.params.find((p) => p.name === label);
    const values = param?.enum && enumsOut[param.enum];
    if (values && /^[A-Za-z]/.test(value) && !values.includes(value)) {
      const s = squash(value);
      const hit =
        values.find((v) => squash(v) === s) ??
        values.find((v) => squash(v).length >= 3 && (s.includes(squash(v)) || squash(v).includes(s))) ??
        // Dynamic enums also accept free values, so only fixed enums fall back to a valid value.
        (param.type === "Enum" ? values[0] : undefined);
      if (hit) return `${label}: ${hit}`;
    }
    // Bundle identifiers must be quoted: "com.apple.mobilesafari".
    if (/^[A-Za-z][\w-]*(\.[\w-]+){2,}$/.test(value)) return `${label}: "${value}"`;
    // Time spans and quantities must be quoted ("10 min"); bare `10 min` is a syntax error.
    if (/^(Time Span|Measurement Quantity|Time)$/.test(param?.type ?? "") && /^\d[\w.]*\s+\w+$/.test(value)) {
      return `${label}: "${value}"`;
    }
    return `${label}: ${value}`;
  });
  return ex.replace(call[0], `${action.name}(${parts.join(", ")})`);
}
for (const a of byKey.values()) a.example = normalizeExample(a);

// ---- #Color / #Icon values ---------------------------------------------------------------
// The docs list lowercase names; the open-source compiler uses camelCase (lightBlue,
// shoppingCart). Keep both spellings so the validator can accept either.
const metadataHtml = readFileSync(join(docsDir, "Language_Guide/metadata.html"), "utf8");
const colorsAt = metadataHtml.indexOf("Available Colors");
const iconsAt = metadataHtml.indexOf("Available Icons");
const arrowNames = (s) => [...s.matchAll(/→\s*([A-Za-z0-9]+)/g)].map((m) => m[1]);
const modelsDir = join(coreDir, "Sources/Open-Jellycore/Core/Compiler/Shortcuts Equivelent Models");
const swiftCases = (file) => {
  const src = readFileSync(join(modelsDir, file), "utf8");
  return [...src.slice(0, src.indexOf("public var")).matchAll(/^\s*case\s+`?(\w+)`?\s*$/gm)].map((m) => m[1]);
};
const uniq = (xs) => [...new Set(xs)];
const metadata = {
  colors: uniq([...arrowNames(metadataHtml.slice(colorsAt, iconsAt)), ...swiftCases("ShortcutColor.swift")]),
  icons: uniq([...arrowNames(metadataHtml.slice(iconsAt)), ...swiftCases("ShortcutGlyph.swift")]),
};

let docsCommit = "unknown";
try {
  docsCommit = execFileSync("git", ["-C", docsDir, "log", "-1", "--format=%h %cs"]).toString().trim();
} catch {}

const libraries = Object.values(LIBRARIES)
  .map((l) => ({ ...l, actions: [...byKey.values()].filter((a) => a.library === l.import).length }))
  .filter((l) => l.actions > 0);

const catalog = {
  generated: new Date().toISOString().slice(0, 10),
  source: `docs.jellycuts.com @ ${docsCommit}; enum values from OpenJelly/Open-Jellycore`,
  libraries,
  metadata,
  enums: enumsOut,
  actions: [...byKey.values()],
};

// One action per line: small file, readable diffs when the docs change.
const lines = [
  "{",
  `"generated": ${JSON.stringify(catalog.generated)},`,
  `"source": ${JSON.stringify(catalog.source)},`,
  `"libraries": [\n${catalog.libraries.map((l) => JSON.stringify(l)).join(",\n")}\n],`,
  `"metadata": {\n"colors": ${JSON.stringify(metadata.colors)},\n"icons": ${JSON.stringify(metadata.icons)}\n},`,
  `"enums": {\n${Object.entries(catalog.enums).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n},`,
  `"actions": [\n${catalog.actions.map((a) => JSON.stringify(a)).join(",\n")}\n]`,
  "}",
];
mkdirSync(join(root, "data"), { recursive: true });
writeFileSync(join(root, "data/catalog.json"), lines.join("\n") + "\n");
const missingEnums = [...usedEnums].filter((e) => !enums[e]);
console.log(
  `Wrote data/catalog.json: ${catalog.actions.length} actions, ${libraries.length} libraries, ` +
    `${Object.keys(enumsOut).length} enums (${missingEnums.length} enum types without known values).`,
);
