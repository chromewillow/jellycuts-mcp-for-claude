// A conservative linter for Jelly scripts.
//
// It cannot run the real Jellycuts compiler (that lives inside the iOS app), so it checks the
// things that most often break a build: unknown functions and labels, missing imports,
// invalid enum values, unbalanced blocks, Jelly 2 leftovers and syntax from other languages.
// "error" means the build will almost certainly fail or silently misbehave; "warning" means
// it's worth a look; "info" is a heads-up that never blocks.

import {
  type Action,
  type DictForm,
  type Param,
  catalog,
  closest,
  dictionaryRule,
  enumAlias,
  enumSpellings,
  enumValues,
  findActions,
  findLibrary,
  libraryNames,
  suggestActions,
  writeDict,
} from "../catalog";
import { type Interpolation, type Token, lex } from "./lexer";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  line: number;
  col: number;
  message: string;
  fix?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: number;
  warnings: number;
  diagnostics: Diagnostic[];
  stats: { lines: number; actions: number; imports: string[]; functions: string[] };
}

const GLOBALS = new Set(["ShortcutInput", "Clipboard", "CurrentDate", "Ask"]);
const LOOP_VAR = /^Repeat(Item|Index)\d*$/;
const V2_NAMES: Record<string, string> = {
  "shortcut input": "ShortcutInput",
  "current date": "CurrentDate",
  "repeat item": "RepeatItem",
  "repeat index": "RepeatIndex",
};
const CAST_TYPES = [
  "AppStore", "Article", "Boolean", "Contact", "Date", "Dictionary", "Email", "File", "Image", "iMedia", "iProduct",
  "Location", "MapLink", "Media", "Number", "PDF", "PhoneNumber", "Photo", "Place", "RichText", "Webpage", "Text",
  "URL", "VCard",
];
const TYPE_HINTS = new Set(["str", "int", "bool", "list", "dict", "date", "any"]);
const COMPARISON_OPS = new Set(["==", "!=", "<", "<=", ">", ">=", "::", "!:", "$$", "$!"]);
const MATH_OPS = new Set(["+", "-", "*", "/", "%", "^"]);
const FOREIGN_KEYWORDS: Record<string, string> = {
  let: "Use `var name = value`.",
  const: "Use `var name = value`.",
  while: "Jelly has no while loop. Use `repeat(n) { }` or `repeatEach(list) { }`.",
  for: "Jelly has no for loop. Use `repeatEach(list) { }` (RepeatItem/RepeatIndex) or `repeat(n) { }`.",
  foreach: "Use `repeatEach(list) { }`.",
  forEach: "Use `repeatEach(list) { }`.",
  function: "Declare functions with `func name(param) { }` (or `macro`).",
  def: "Declare functions with `func name(param) { }` (or `macro`).",
  fn: "Declare functions with `func name(param) { }` (or `macro`).",
  switch: "Use `menu(\"Prompt\") { case \"A\": … }` for a user choice, or nested `if`s.",
  elif: "Jelly has no else-if. Put another `if` inside `else { }`.",
  elseif: "Jelly has no else-if. Put another `if` inside `else { }`.",
  try: "Jelly has no try/catch.",
  class: "Jelly has no classes.",
  struct: "Jelly has no structs.",
};
const PREMIUM_LIBRARIES = new Set(["RoutineHubAds"]);
/** Parameter types the docs don't describe precisely; their values aren't second-guessed. */
const LOOSE_TYPES = new Set(["Unknown", "Literal", "Object", "Filter", "Filter Type", "Order", "Sort"]);
// The open-source compiler spells a few library names differently from the docs.
const LIBRARY_ALIASES: Record<string, string> = { ToolboxPro: "Toolbox", AShell: "aShell", AShellMini: "aShellMini" };

type Expr =
  | { k: "string"; tok: Token; interps: Interpolation[] }
  | { k: "number"; tok: Token }
  | { k: "bool"; tok: Token }
  | { k: "nil"; tok: Token }
  | { k: "ident"; tok: Token; name: string; modifiers: { kind: string; arg: string }[]; index?: Expr }
  | { k: "call"; tok: Token; name: string; args: Arg[] }
  | { k: "array"; tok: Token; items: Expr[] }
  | { k: "dict"; tok: Token }
  /** The raw text of a bare multi-word enum value: `File Extension`, `en-US`, `ISO 8601`. */
  | { k: "words"; tok: Token; raw: string }
  | { k: "binary"; tok: Token; op: string; left: Expr; right: Expr }
  | { k: "error"; tok: Token };

interface Arg {
  label?: string;
  labelTok?: Token;
  value: Expr;
}

interface VarInfo {
  kind: "var" | "output" | "param" | "global";
  line: number;
}

interface Scope {
  vars: Map<string, VarInfo>;
  /** func bodies run as a separate shortcut invocation and can't see outer variables. */
  isolated: boolean;
}

interface FuncDef {
  kind: "func" | "macro";
  name: string;
  params: string[];
  line: number;
}

class Validator {
  private tokens: Token[];
  /** Normalized source; token offsets point into it. */
  private src: string;
  private pos = 0;
  private diags: Diagnostic[] = [];
  private imports = new Map<string, number>();
  private firstCodeLine = 0;
  private allDefs = new Map<string, FuncDef>();
  private definedFuncs = new Map<string, FuncDef>();
  private scopes: Scope[] = [{ vars: new Map(), isolated: false }];
  private everDefined = new Map<string, number>();
  private loopDepth = 0;
  private funcKind: "func" | "macro" | null = null;
  private actionCalls = 0;
  private reportedUndefined = new Set<string>();

  constructor(private source: string) {
    const { tokens, problems, source: src } = lex(source);
    this.tokens = tokens;
    this.src = src;
    for (const p of problems) this.report(p.severity, p.line, p.col, p.message, p.fix);
    for (const g of GLOBALS) this.scopes[0].vars.set(g, { kind: "global", line: 0 });
  }

  run(): ValidationResult {
    this.prescan();
    while (!this.at("eof")) {
      if (this.isPunct("}")) {
        this.error(this.peek(), "Unmatched `}` — there is no block open here.", "Remove it, or check the `{` above.");
        this.next();
        continue;
      }
      this.statement();
    }
    this.finalChecks();
    const diagnostics = this.diags.sort((a, b) => a.line - b.line || a.col - b.col);
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.filter((d) => d.severity === "warning").length;
    return {
      ok: errors === 0,
      errors,
      warnings,
      diagnostics,
      stats: {
        lines: this.source.split("\n").length,
        actions: this.actionCalls,
        imports: [...this.imports.keys()],
        functions: [...this.allDefs.keys()],
      },
    };
  }

  // ---- token helpers ----------------------------------------------------------------------
  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }
  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }
  private at(type: Token["type"]): boolean {
    return this.peek().type === type;
  }
  private isPunct(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.type === "punct" && t.value === value;
  }
  private isIdent(value?: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.type === "ident" && (value === undefined || t.value === value);
  }
  private skipNewlines() {
    while (this.at("newline")) this.next();
  }
  /** Skips the rest of the current line (used to recover after an error). */
  private skipLine() {
    let depth = 0;
    while (!this.at("eof")) {
      const t = this.peek();
      if (t.type === "newline" && depth <= 0) break;
      if (t.type === "punct" && "([{".includes(t.value)) depth++;
      if (t.type === "punct" && ")]}".includes(t.value)) {
        if (depth === 0) break;
        depth--;
      }
      this.next();
    }
  }
  private expectPunct(value: string, context: string): boolean {
    if (this.isPunct(value)) {
      this.next();
      return true;
    }
    const t = this.peek();
    this.error(t, `Expected \`${value}\` ${context}, found ${describe(t)}.`);
    return false;
  }

  // ---- reporting --------------------------------------------------------------------------
  private report(severity: Severity, line: number, col: number, message: string, fix?: string) {
    if (this.diags.some((d) => d.line === line && d.message === message)) return;
    this.diags.push(fix ? { severity, line, col, message, fix } : { severity, line, col, message });
  }
  private error(t: Token, message: string, fix?: string) {
    this.report("error", t.line, t.col, message, fix);
  }
  private warn(t: Token, message: string, fix?: string) {
    this.report("warning", t.line, t.col, message, fix);
  }
  private info(t: Token, message: string, fix?: string) {
    this.report("info", t.line, t.col, message, fix);
  }

  // ---- scopes -----------------------------------------------------------------------------
  private define(name: string, kind: VarInfo["kind"], t: Token) {
    const scope = this.scopes[this.scopes.length - 1];
    if (!scope.vars.has(name) || kind !== "var") scope.vars.set(name, { kind, line: t.line });
    if (!this.everDefined.has(name)) this.everDefined.set(name, t.line);
  }
  private lookup(name: string): VarInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].vars.get(name);
      if (v) return v;
      if (this.scopes[i].isolated) return GLOBALS.has(name) ? { kind: "global", line: 0 } : undefined;
    }
    return undefined;
  }
  private visibleNames(): string[] {
    const names: string[] = [];
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      names.push(...this.scopes[i].vars.keys());
      if (this.scopes[i].isolated) break;
    }
    return names;
  }
  private outerHas(name: string): boolean {
    return this.scopes.some((s) => s.vars.has(name));
  }

  /** Checks that a variable name used as a value exists. */
  private useVariable(name: string, t: Token) {
    if (LOOP_VAR.test(name)) {
      if (this.loopDepth === 0 && !this.reportedUndefined.has(name)) {
        this.reportedUndefined.add(name);
        this.warn(t, `\`${name}\` only exists inside \`repeat\` / \`repeatEach\` blocks.`);
      }
      return;
    }
    if (this.lookup(name)) return;
    const key = `${name}@${this.scopes.length}`;
    if (this.reportedUndefined.has(key)) return;
    this.reportedUndefined.add(key);
    if (this.funcKind === "func" && this.outerHas(name)) {
      this.warn(
        t,
        `\`${name}\` is defined outside this func. A func runs as a separate call and can't see outer variables.`,
        `Pass it in as a parameter (func f(${name}) …), or use a macro instead of a func.`,
      );
      return;
    }
    const later = this.prescanDefs.get(name);
    if (later !== undefined && later > t.line) {
      this.warn(t, `\`${name}\` is used before it is created (line ${later}).`, "Move the line that creates it above this one.");
      return;
    }
    const sugg = closest(name, [...this.visibleNames(), ...GLOBALS]);
    this.warn(
      t,
      `\`${name}\` is not defined.`,
      sugg.length
        ? `Did you mean ${sugg.map((s) => `\`${s}\``).join(" or ")}?`
        : "Create it with `var " + name + " = …` or capture an action's output with `>> " + name + "`.",
    );
  }

  // ---- prescan ----------------------------------------------------------------------------
  private prescanDefs = new Map<string, number>();
  private prescan() {
    const t = this.tokens;
    for (let i = 0; i < t.length; i++) {
      const tok = t[i];
      if (tok.type === "ident" && (tok.value === "func" || tok.value === "macro") && t[i + 1]?.type === "ident") {
        const name = t[i + 1].value;
        const params: string[] = [];
        if (t[i + 2]?.value === "(") {
          for (let j = i + 3; j < t.length && t[j].value !== ")"; j++) {
            // A name not preceded by ":" is a parameter (after ":" comes its type hint).
            if (t[j].type === "ident" && t[j - 1]?.value !== ":") params.push(t[j].value);
          }
        }
        if (!this.allDefs.has(name)) this.allDefs.set(name, { kind: tok.value as "func" | "macro", name, params, line: tok.line });
      }
      if (tok.type === "ident" && tok.value === "var" && t[i + 1]?.type === "ident") this.recordPrescan(t[i + 1]);
      if (tok.type === "punct" && tok.value === ">>" && t[i + 1]?.type === "ident") this.recordPrescan(t[i + 1]);
    }
  }
  private recordPrescan(tok: Token) {
    if (!this.prescanDefs.has(tok.value)) this.prescanDefs.set(tok.value, tok.line);
  }

  // ---- statements -------------------------------------------------------------------------
  private statement() {
    this.skipNewlines();
    const t = this.peek();
    if (t.type === "eof" || this.isPunct("}")) return;

    if (t.type === "punct") {
      if (t.value === "#") return this.flags();
      if (t.value === ";") {
        this.warn(t, "Jelly doesn't use semicolons.", "Remove the `;`.");
        this.next();
        return;
      }
      if (t.value === "{") {
        this.error(t, "A `{` block can only follow `if`, `else`, `repeat`, `repeatEach`, `menu`, `func` or `macro`.");
        this.next();
        this.block(t);
        return;
      }
      this.error(t, `Unexpected ${describe(t)} at the start of a line.`);
      this.next();
      this.skipLine();
      return;
    }
    if (t.type === "string" || t.type === "mstring" || t.type === "number" || t.type === "dict") {
      this.warn(t, "A value on its own line does nothing.", 'To create text use `text(text: "…") >> name` or `var name = "…"`.');
      this.next();
      this.endOfStatement();
      return;
    }

    if (!this.firstCodeLine && t.value !== "import") this.firstCodeLine = t.line;
    switch (t.value) {
      case "import":
        return this.importStatement();
      case "var":
        return this.assignment(true);
      case "let":
      case "const":
        this.error(t, `\`${t.value}\` is not Jelly.`, FOREIGN_KEYWORDS[t.value]);
        return this.assignment(true);
      case "if":
        return this.ifStatement();
      case "else":
        this.error(t, "`else` without a matching `if` block right before it.");
        this.next();
        if (this.isPunct("{")) this.block(this.next());
        return;
      case "repeat":
        return this.repeatStatement();
      case "repeatEach":
        return this.repeatEachStatement();
      case "menu":
        return this.menuStatement();
      case "case":
        this.error(t, "`case` is only allowed directly inside a `menu { }` block.");
        this.skipLine();
        return;
      case "func":
      case "macro":
        return this.funcDefinition();
      case "return":
        return this.returnStatement();
    }
    if (FOREIGN_KEYWORDS[t.value] && !findActions(t.value).length && !this.allDefs.has(t.value)) {
      this.error(t, `\`${t.value}\` is not part of Jelly.`, FOREIGN_KEYWORDS[t.value]);
      this.next();
      this.skipLine();
      if (this.isPunct("{")) this.block(this.next());
      return;
    }
    if (this.peek(1).type === "punct" && this.peek(1).value === "(") {
      const call = this.parseCall();
      this.checkCall(call);
      this.outputCapture();
      this.endOfStatement();
      return;
    }
    if (this.isPunct("=", 1) || this.isPunct("+=", 1) || this.isPunct("-=", 1)) return this.assignment(false);
    if (this.isPunct(".", 1)) {
      // e.g. `x.something()` — method calls don't exist in Jelly.
      this.error(t, `Method-call syntax (\`${t.value}.…\`) isn't Jelly.`, "Call actions as functions: `action(label: value)`, and use .as() / .key() / .get() only as value modifiers.");
      this.skipLine();
      return;
    }
    if (this.peek(1).type === "ident" && this.peek(1).line === t.line) {
      const v2 = V2_NAMES[`${t.value} ${this.peek(1).value}`.toLowerCase()];
      this.error(
        t,
        v2 ? `\`${t.value} ${this.peek(1).value}\` is the old Jelly 2 spelling.` : `Unexpected \`${t.value} ${this.peek(1).value}\` — names can't contain spaces and statements need \`(\`, \`=\` or a keyword.`,
        v2 ? `Write \`${v2}\`.` : undefined,
      );
      this.skipLine();
      return;
    }
    this.error(t, `\`${t.value}\` on its own doesn't do anything.`, `Call an action like \`${t.value}(…)\`, or assign with \`${t.value} = …\`.`);
    this.next();
    this.skipLine();
  }

  /** After a statement only a newline, `}` or end of file may follow on the same line. */
  private endOfStatement(): void {
    const t = this.peek();
    if (t.type === "newline" || t.type === "eof" || (t.type === "punct" && t.value === "}")) return;
    if (t.type === "punct" && t.value === ";") {
      this.warn(t, "Jelly doesn't use semicolons.", "Remove the `;`.");
      this.next();
      return this.endOfStatement();
    }
    this.error(t, `Unexpected ${describe(t)} after the end of the statement.`, "Put one statement per line.");
    this.skipLine();
  }

  private outputCapture() {
    if (!this.isPunct(">>")) return;
    const arrow = this.next();
    const name = this.peek();
    if (name.type !== "ident") {
      this.error(arrow, "`>>` must be followed by a name for the output.");
      return;
    }
    this.next();
    if (this.at("ident") && this.peek().line === name.line) {
      const words = [name.value];
      while (this.at("ident") && this.peek().line === name.line) words.push(this.next().value);
      this.error(name, `Output names can't contain spaces (\`${words.join(" ")}\`).`, `Use \`${words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("")}\`.`);
    }
    if (GLOBALS.has(name.value)) this.error(name, `\`${name.value}\` is a built-in variable; pick another output name.`);
    if (this.lookup(name.value)?.kind === "var") {
      this.warn(name, `\`${name.value}\` is already a \`var\`; reusing the name for an output is confusing.`);
    }
    this.define(name.value, "output", name);
  }

  private block(open: Token) {
    while (true) {
      this.skipNewlines();
      if (this.at("eof")) {
        this.error(open, `This \`{\` (line ${open.line}) is never closed with \`}\`.`);
        return;
      }
      if (this.isPunct("}")) {
        this.next();
        return;
      }
      const before = this.pos;
      this.statement();
      if (this.pos === before) this.next();
    }
  }

  private importStatement() {
    const kw = this.next();
    const t = this.peek();
    if (t.type !== "ident") {
      this.error(kw, "`import` needs a library name, e.g. `import Shortcuts`.");
      this.skipLine();
      return;
    }
    this.next();
    let name = t.value;
    if (!findLibrary(name)) {
      const alias = LIBRARY_ALIASES[name];
      const exact = libraryNames.find((l) => l.toLowerCase() === name.toLowerCase());
      if (alias) {
        this.warn(t, `The Jellycuts docs spell this library \`${alias}\`.`, `Use \`import ${alias}\`.`);
        name = alias;
      } else if (exact) {
        this.error(t, `Library names are case-sensitive: \`${name}\` should be \`${exact}\`.`, `Write \`import ${exact}\`.`);
        name = exact;
      } else {
        const sugg = closest(name, libraryNames);
        this.error(
          t,
          `Unknown library \`${name}\`.`,
          (sugg.length ? `Did you mean ${sugg.map((s) => `\`${s}\``).join(" or ")}? ` : "") + `Available: ${libraryNames.join(", ")}.`,
        );
        this.endOfStatement();
        return;
      }
    }
    if (this.imports.has(name)) this.warn(t, `\`${name}\` is already imported on line ${this.imports.get(name)}.`);
    else this.imports.set(name, t.line);
    if (this.firstCodeLine && this.firstCodeLine < t.line) {
      this.warn(t, "Imports only apply to lines below them.", "Move all imports to the top of the script.");
    }
    if (PREMIUM_LIBRARIES.has(name)) this.info(t, `\`${name}\` requires a Jellycuts Premium subscription.`);
    else if (name !== "Shortcuts" && name !== "Jellycuts") {
      const lib = findLibrary(name);
      this.info(t, `\`import ${name}\` uses actions from the ${lib?.app ?? name} app — it must be installed on the iPhone.`);
    }
    this.endOfStatement();
  }

  private flags() {
    while (this.isPunct("#")) {
      const hash = this.next();
      const nameTok = this.peek();
      if (nameTok.type !== "ident") {
        this.error(hash, "`#` must be followed by `Color` or `Icon`, e.g. `#Color: blue, #Icon: star`.");
        this.skipLine();
        return;
      }
      this.next();
      const flag = nameTok.value;
      if (flag !== "Color" && flag !== "Icon") {
        const fixed = flag.toLowerCase() === "color" || flag.toLowerCase() === "colour" ? "Color" : flag.toLowerCase() === "icon" ? "Icon" : undefined;
        this.error(nameTok, `Unknown metadata \`#${flag}\`.`, fixed ? `Write \`#${fixed}\` (case-sensitive).` : "Only `#Color:` and `#Icon:` exist.");
      }
      if (!this.expectPunct(":", `after #${flag}`)) {
        this.skipLine();
        return;
      }
      const valueTok = this.peek();
      if (valueTok.type !== "ident" && valueTok.type !== "number") {
        this.error(valueTok, `#${flag} needs a value, e.g. \`#${flag}: ${flag === "Icon" ? "star" : "blue"}\`.`);
        this.skipLine();
        return;
      }
      this.next();
      const list = flag === "Icon" ? catalog.metadata.icons : flag === "Color" ? catalog.metadata.colors : [];
      if (list.length && !list.some((v) => v.toLowerCase() === valueTok.value.toLowerCase())) {
        const sugg = closest(valueTok.value, list);
        this.warn(
          valueTok,
          `\`${valueTok.value}\` is not a known ${flag.toLowerCase()} — Jellycuts will refuse to build.`,
          sugg.length ? `Try ${sugg.map((s) => `\`${s}\``).join(", ")}.` : flag === "Color" ? `Use one of: ${catalog.metadata.colors.slice(0, 15).join(", ")}.` : "Use an icon from the guide, e.g. star, heart, gear.",
        );
      }
      if (this.at("ident") && this.peek().line === valueTok.line) {
        this.error(this.peek(), `#${flag} values are a single word (no spaces).`);
        this.skipLine();
        return;
      }
      if (this.isPunct(",")) this.next();
    }
    this.endOfStatement();
  }

  private assignment(declared: boolean) {
    const kw = declared ? this.next() : undefined;
    const nameTok = this.peek();
    if (nameTok.type !== "ident") {
      this.error(kw ?? nameTok, "`var` must be followed by a name.");
      this.skipLine();
      return;
    }
    this.next();
    if (this.at("ident") && this.peek().line === nameTok.line) {
      const words = [nameTok.value];
      while (this.at("ident") && this.peek().line === nameTok.line) words.push(this.next().value);
      this.error(nameTok, `Variable names can't contain spaces (\`${words.join(" ")}\`).`, `Use \`${words.join("")}\`.`);
    }
    const name = nameTok.value;
    const opTok = this.peek();
    if (!(opTok.type === "punct" && (opTok.value === "=" || opTok.value === "+=" || opTok.value === "-="))) {
      this.error(nameTok, `\`${name}\` needs a value: \`var ${name} = …\`.`);
      this.skipLine();
      return;
    }
    this.next();
    if (opTok.value === "-=") this.error(opTok, "`-=` isn't supported.", `Use \`calculate(input: "\${${name}} - 1") >> new${cap(name)}\` then \`${name} = new${cap(name)}\`.`);
    const existing = this.lookup(name);
    if (existing?.kind === "global") this.error(nameTok, `\`${name}\` is a built-in variable and can't be changed.`, `Copy it first: \`var my${name} = ${name}\`.`);
    else if (existing?.kind === "output") {
      this.error(nameTok, `\`${name}\` is an action output (from \`>>\`) and is read-only.`, `Copy it into a variable with a different name: \`var my${cap(name)} = ${name}\`.`);
    } else if (LOOP_VAR.test(name)) this.error(nameTok, `\`${name}\` is a built-in loop variable and can't be changed.`);
    if (opTok.value === "+=" && !existing && !declared) this.warn(nameTok, `\`${name} +=\` appends to a variable that doesn't exist yet.`, `Create it first, e.g. \`var ${name} = ""\`.`);
    if (opTok.value === "+=") this.info(opTok, "`+=` (append) is documented for current Jellycuts; very old versions don't support it.");

    const value = this.parseExpr();
    this.checkValueExpr(value, "assign");
    if (!declared && !existing) this.define(name, "var", nameTok);
    else if (declared) this.define(name, "var", nameTok);
    if (this.isPunct(">>")) this.error(this.peek(), "`>>` can't follow an assignment.", "Either `var x = …` or `action(…) >> x`, not both.");
    this.endOfStatement();
  }

  private ifStatement() {
    const kw = this.next();
    let paren = false;
    let parenTok: Token | undefined;
    // `if (a == b) {` — documented, but rejected by the open-source compiler's grammar.
    if (this.isPunct("(")) {
      parenTok = this.next();
      paren = true;
      this.warn(parenTok, "Parentheses around an if condition are rejected by some Jellycuts versions.", "Write it without them: `if level < 20 {`.");
    }
    this.condition(kw);
    if (paren && !this.expectPunct(")", `to close the \`(\` opened on line ${parenTok!.line}`)) this.skipUntilBrace();
    if (!this.isPunct("{")) {
      this.error(this.peek(), "Expected `{` to start the if block.");
      this.skipUntilBrace();
      if (!this.isPunct("{")) return;
    }
    this.block(this.next());
    this.outputCapture();
    // `else` may follow on the same line or the next.
    let look = 0;
    while (this.peek(look).type === "newline") look++;
    if (this.isIdent("else", look)) {
      for (let i = 0; i < look; i++) this.next();
      const elseTok = this.next();
      if (this.isIdent("if")) {
        this.error(elseTok, "`else if` isn't supported in Jelly.", "Nest it: `else { if … { } }`.");
        this.ifStatement();
        return;
      }
      if (!this.isPunct("{")) {
        this.error(this.peek(), "Expected `{` after `else`.");
        this.skipUntilBrace();
        if (!this.isPunct("{")) return;
      }
      this.block(this.next());
      this.outputCapture();
    }
    this.endOfStatement();
  }

  private skipUntilBrace() {
    while (!this.at("eof") && !this.isPunct("{") && !this.at("newline")) this.next();
  }

  private condition(kw: Token) {
    const left = this.peek();
    if (left.type === "punct" && left.value === "{") {
      this.error(kw, "`if` needs a condition, e.g. `if count > 3 {`.");
      return;
    }
    if (left.type === "punct" && left.value === "!") {
      this.error(left, "`!` negation isn't supported.", "Compare explicitly, e.g. `if value == nil {` or `if flag == 0 {`.");
      this.next();
    }
    const lhs = this.parsePrimary();
    if (lhs.k === "string" || lhs.k === "number") {
      this.error(lhs.tok, "The left side of a comparison must be a variable or output.", "Put the variable first: `if name == \"Ada\" {`.");
    } else if (lhs.k === "call") {
      this.warn(lhs.tok, "Calling an action inside an `if` condition isn't supported.", `Run it first: \`${lhs.name}(…) >> result\`, then \`if result …\`.`);
      this.checkCall(lhs);
    } else this.checkValueExpr(lhs, "condition");

    const opTok = this.peek();
    // Docs-era spellings: `.contains "x"`, `!contains "x"`, `.beginsWith`, `.endsWith`, `.between`
    if (opTok.type === "punct" && (opTok.value === "." || opTok.value === "!") && this.peek(1).type === "ident") {
      const word = this.peek(1).value;
      const map: Record<string, string> = { contains: opTok.value === "!" ? "!:" : "::", beginsWith: "$$", endsWith: "$!" };
      if (map[word] || word === "between") {
        if (map[word]) this.warn(opTok, `\`${opTok.value}${word}\` is the old operator spelling.`, `Use \`${map[word]}\` (Jelly 3): \`if text ${map[word]} "abc" {\`.`);
        else this.warn(opTok, "`.between` may not be supported.", "Use two nested ifs: `if x >= low { if x <= high { … } }`.");
        this.next();
        this.next();
        while (!this.isPunct("{") && !this.isPunct(")") && !this.isPunct("&&") && !this.isPunct("||") && !this.at("newline") && !this.at("eof")) this.next();
      }
    } else if (opTok.type === "punct" && COMPARISON_OPS.has(opTok.value)) {
      this.next();
      const rhs = this.parseExpr();
      if (rhs.k === "ident" && rhs.name !== "nil") {
        this.warn(
          rhs.tok,
          `Comparing against a variable (\`${rhs.name}\`) may compare against the literal text instead.`,
          `Interpolate it: \`"\${${rhs.name}}"\`. For numbers, compute the difference with calculate() and compare to 0.`,
        );
        this.checkValueExpr(rhs, "condition");
      } else if (rhs.k === "call" || rhs.k === "binary") {
        this.warn(rhs.tok, "The right side of a comparison should be a number, a \"string\" or nil.", "Compute the value first and capture it with `>>`.");
      } else this.checkValueExpr(rhs, "condition");
    } else if (opTok.type === "punct" && (opTok.value === "=" || opTok.value === "===")) {
      this.error(opTok, "Use `==` to compare (`=` assigns).");
      this.next();
      this.parseExpr();
    } else if (!(opTok.type === "punct" && (opTok.value === "{" || opTok.value === ")" || opTok.value === "&&" || opTok.value === "||"))) {
      this.error(opTok, `Unexpected ${describe(opTok)} in the if condition.`, "Conditions look like `if value == \"text\" {` — one comparison per if.");
      while (!this.isPunct("{") && !this.at("newline") && !this.at("eof")) this.next();
      return;
    } else if (lhs.k !== "error" && !(opTok.type === "punct" && (opTok.value === "&&" || opTok.value === "||"))) {
      this.warn(lhs.tok, "A bare `if value {` doesn't reliably test true/false.", "Compare explicitly: `if value == 1 {`, `if value != nil {`.");
    }
    if (this.isPunct("&&") || this.isPunct("||")) {
      const logic = this.next();
      this.error(
        logic,
        `\`${logic.value}\` doesn't work in Jellycuts conditions (it compiles to the wrong check).`,
        logic.value === "&&" ? "Nest two ifs: `if a == 1 { if b == 2 { … } }`." : "Use separate ifs (or combine values into text and use `::`).",
      );
      while (!this.isPunct("{") && !this.isPunct(")") && !this.at("newline") && !this.at("eof")) this.next();
    }
  }

  private repeatStatement() {
    this.next();
    const paren = this.isPunct("(");
    if (paren) this.next();
    const count = this.parseExpr();
    if (count.k === "ident") this.checkValueExpr(count, "value");
    else if (count.k === "number") {
      if (count.tok.value.includes(".")) this.error(count.tok, "`repeat` needs a whole number.");
    } else if (count.k !== "error") {
      this.warn(count.tok, "`repeat` takes a whole number or a variable.", "Compute the count first and capture it with `>>`.");
    }
    if (paren) this.expectPunct(")", "after the repeat count");
    if (!this.isPunct("{")) {
      this.error(this.peek(), "Expected `{` to start the repeat block.");
      this.skipUntilBrace();
      if (!this.isPunct("{")) return;
    }
    this.loopDepth++;
    this.block(this.next());
    this.loopDepth--;
    this.outputCapture();
    this.endOfStatement();
  }

  private repeatEachStatement() {
    this.next();
    const paren = this.isPunct("(");
    if (paren) this.next();
    const list = this.parseExpr();
    if (list.k === "ident") this.checkValueExpr(list, "value");
    else if (list.k === "array") {
      this.warn(list.tok, "Loop over a variable, not an inline list.", 'Create the list first: `list(items: ["a", "b"]) >> items` then `repeatEach(items) {`.');
      this.checkValueExpr(list, "value");
    } else if (list.k !== "error") this.error(list.tok, "`repeatEach` needs a list variable, e.g. `repeatEach(items) {`.");
    if (paren) this.expectPunct(")", "after the list");
    if (!this.isPunct("{")) {
      this.error(this.peek(), "Expected `{` to start the repeatEach block.");
      this.skipUntilBrace();
      if (!this.isPunct("{")) return;
    }
    this.loopDepth++;
    this.block(this.next());
    this.loopDepth--;
    this.outputCapture();
    this.endOfStatement();
  }

  private menuStatement() {
    const kw = this.next();
    const paren = this.isPunct("(");
    if (paren) {
      const p = this.next();
      this.warn(p, '`menu("Prompt") {` is rejected by some Jellycuts versions.', 'Write `menu "Prompt" {` (no parentheses), or use `choose(list:, prompt:)` with `if`.');
    }
    const prompt = this.parseExpr();
    if (prompt.k !== "string") {
      if (prompt.k === "ident") this.checkValueExpr(prompt, "value");
      else this.error(prompt.tok, 'A menu needs a prompt string: `menu("Choose one") {`.');
    } else this.checkValueExpr(prompt, "value");
    if (this.isPunct(",")) {
      // Jelly 2 style: menu("Prompt", ["A", "B"]) — still accepted by the docs.
      this.next();
      this.parseExpr();
    }
    if (paren) this.expectPunct(")", "after the menu prompt");
    if (!this.isPunct("{")) {
      this.error(this.peek(), "Expected `{` to start the menu block.");
      this.skipUntilBrace();
      if (!this.isPunct("{")) return;
    }
    const open = this.next();
    const labels = new Map<string, number>();
    let cases = 0;
    while (true) {
      this.skipNewlines();
      if (this.at("eof")) {
        this.error(open, `This menu's \`{\` (line ${open.line}) is never closed with \`}\`.`);
        return;
      }
      if (this.isPunct("}")) {
        this.next();
        break;
      }
      if (this.isIdent("case")) {
        const caseTok = this.next();
        cases++;
        const p = this.isPunct("(");
        if (p) this.next();
        const label = this.peek();
        if (label.type === "string") {
          this.next();
          if (label.interpolations?.length) this.warn(label, "Menu case labels can't contain variables.");
          if (labels.has(label.value)) this.warn(label, `Duplicate menu case "${label.value}".`);
          labels.set(label.value, label.line);
        } else {
          this.error(caseTok, 'A case needs a quoted label: `case "Option":`.');
        }
        if (p) this.expectPunct(")", "after the case label");
        if (!this.expectPunct(":", "after the case label")) this.skipLine();
        // statements until the next case or the closing brace
        while (true) {
          this.skipNewlines();
          if (this.at("eof") || this.isPunct("}") || this.isIdent("case")) break;
          const before = this.pos;
          this.statement();
          if (this.pos === before) this.next();
        }
        continue;
      }
      this.error(this.peek(), "Inside a menu, code must come after a `case \"Label\":` line.");
      this.skipLine();
    }
    if (cases === 0) this.error(kw, 'This menu has no cases. Add `case "Option":` lines inside it.');
    this.outputCapture();
    this.endOfStatement();
  }

  private funcDefinition() {
    const kw = this.next();
    const kind = kw.value as "func" | "macro";
    const nameTok = this.peek();
    if (nameTok.type !== "ident") {
      this.error(kw, `\`${kind}\` needs a name: \`${kind} myHelper(input) { … }\`.`);
      this.skipLine();
      return;
    }
    this.next();
    if (this.funcKind) this.error(kw, `A ${kind} can't be declared inside another func or macro.`);
    if (this.definedFuncs.has(nameTok.value)) this.error(nameTok, `\`${nameTok.value}\` is declared twice (first on line ${this.definedFuncs.get(nameTok.value)!.line}).`, "Give each func/macro a unique name.");
    if (findActions(nameTok.value).length) this.warn(nameTok, `\`${nameTok.value}\` has the same name as a built-in action, which makes calls ambiguous.`, "Rename it.");
    const params: { name: string; tok: Token }[] = [];
    if (!this.expectPunct("(", `after the ${kind} name`)) {
      this.skipUntilBrace();
    } else {
      while (!this.isPunct(")") && !this.at("eof") && !this.isPunct("{")) {
        const p = this.peek();
        if (p.type === "newline" || (p.type === "punct" && p.value === ",")) {
          this.next();
          continue;
        }
        if (p.type !== "ident") {
          this.error(p, `Parameters must be plain names, e.g. \`${kind} ${nameTok.value}(input, count: int)\`.`);
          this.next();
          continue;
        }
        this.next();
        if (this.isPunct(":")) {
          this.next();
          const hint = this.peek();
          if (hint.type === "ident") {
            this.next();
            if (!TYPE_HINTS.has(hint.value)) this.warn(hint, `Unknown type hint \`${hint.value}\`.`, "Use str, int, bool, list, dict, date or any — or leave the hint out.");
            else this.info(hint, "Typed parameters need a recent Jellycuts (March 2026 or later).");
          }
        }
        if (params.some((x) => x.name === p.value)) this.error(p, `Parameter \`${p.value}\` is listed twice.`);
        params.push({ name: p.value, tok: p });
      }
      this.expectPunct(")", "to close the parameter list");
    }
    const def: FuncDef = { kind, name: nameTok.value, params: params.map((p) => p.name), line: nameTok.line };
    this.definedFuncs.set(def.name, def);
    if (!this.isPunct("{")) {
      this.error(this.peek(), `Expected \`{\` to start the ${kind} body.`);
      this.skipUntilBrace();
      if (!this.isPunct("{")) return;
    }
    const open = this.next();
    const prevKind = this.funcKind;
    this.funcKind = kind;
    this.scopes.push({ vars: new Map(), isolated: kind === "func" });
    for (const p of params) this.define(p.name, "param", p.tok);
    const prevLoop = this.loopDepth;
    this.loopDepth = 0;
    this.block(open);
    this.loopDepth = prevLoop;
    const scope = this.scopes.pop()!;
    // A macro's body is pasted inline, so variables it creates stay visible afterwards.
    if (kind === "macro") for (const [n, v] of scope.vars) if (v.kind !== "param") this.scopes[this.scopes.length - 1].vars.set(n, v);
    this.funcKind = prevKind;
    this.endOfStatement();
  }

  private returnStatement() {
    const kw = this.next();
    if (!this.funcKind) this.error(kw, "`return` only works inside a func or macro.", "To stop the shortcut use `exit()`; to hand back a value use `output(notes: …)`.");
    if (this.at("newline") || this.at("eof") || this.isPunct("}")) {
      this.warn(kw, "`return` without a value.", "Return a variable: `return result`.");
      return;
    }
    const value = this.parseExpr();
    this.checkValueExpr(value, "return");
    if (value.k !== "ident") this.info(value.tok, "Returning an expression needs Jellycuts March 2026 or later; returning a variable works everywhere.");
    this.endOfStatement();
  }

  // ---- expressions ------------------------------------------------------------------------
  private parseExpr(): Expr {
    let left = this.parsePrimary();
    while (this.peek().type === "punct" && MATH_OPS.has(this.peek().value) && this.peek().line === left.tok.line) {
      const op = this.next();
      const right = this.parsePrimary();
      left = { k: "binary", tok: left.tok, op: op.value, left, right };
    }
    return left;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.type === "string" || t.type === "mstring") {
      this.next();
      return { k: "string", tok: t, interps: t.interpolations ?? [] };
    }
    if (t.type === "number") {
      this.next();
      return { k: "number", tok: t };
    }
    if (t.type === "punct" && t.value === "-" && this.peek(1).type === "number") {
      this.next();
      this.next();
      return { k: "number", tok: t };
    }
    if (t.type === "dict") {
      this.next();
      return { k: "dict", tok: t };
    }
    if (t.type === "punct" && t.value === "[") return this.parseArray();
    if (t.type === "punct" && t.value === "{") return this.parseDict();
    if (t.type === "punct" && t.value === "(") {
      this.next();
      const inner = this.parseExpr();
      this.expectPunct(")", "to close `(`");
      return inner;
    }
    if (t.type === "ident") {
      if (t.value === "true" || t.value === "false") {
        this.next();
        return { k: "bool", tok: t };
      }
      if (t.value === "nil") {
        this.next();
        return { k: "nil", tok: t };
      }
      if (this.isPunct("(", 1)) return this.parseCall();
      this.next();
      const expr: Expr = { k: "ident", tok: t, name: t.value, modifiers: [] };
      // Old spaced names: Shortcut Input, Current Date, Repeat Item …
      if (this.at("ident") && this.peek().line === t.line) {
        const nextWord = this.peek();
        const v2 = V2_NAMES[`${t.value} ${nextWord.value}`.toLowerCase()];
        if (v2) {
          this.error(t, `\`${t.value} ${nextWord.value}\` is the old Jelly 2 spelling.`, `Write \`${v2}\`.`);
          this.next();
          expr.name = v2;
          if (this.at("number") && /^Repeat/.test(v2) && this.peek().line === t.line) expr.name += this.next().value;
        } else if (!["if", "else", "case"].includes(nextWord.value)) {
          const words = [t.value];
          while (this.at("ident") && this.peek().line === t.line) words.push(this.next().value);
          this.error(t, `\`${words.join(" ")}\` — names can't contain spaces.`, "If it's text, put it in quotes. Setting (enum) values may contain spaces only as an action argument, spelled exactly as get_action lists them.");
          expr.name = words.join("");
        }
      }
      while (this.isPunct(".") && this.peek(1).type === "ident") {
        const mod = this.peek(1);
        if (!["as", "get", "key"].includes(mod.value)) break;
        this.next();
        this.next();
        if (!this.isPunct("(")) {
          this.error(mod, `\`.${mod.value}\` needs parentheses: \`.${mod.value}(…)\`.`);
          break;
        }
        this.next();
        let arg = "";
        while (!this.isPunct(")") && !this.at("newline") && !this.at("eof")) arg += this.next().value;
        this.expectPunct(")", `to close .${mod.value}(`);
        if (mod.value === "as" && !CAST_TYPES.includes(arg)) {
          const fix = CAST_TYPES.find((c) => c.toLowerCase() === arg.toLowerCase());
          this.error(mod, `\`.as(${arg})\` isn't a known type.`, fix ? `Write \`.as(${fix})\`.` : `Use one of: ${CAST_TYPES.join(", ")}.`);
        }
        expr.modifiers.push({ kind: mod.value, arg });
      }
      if (this.isPunct(".") && this.peek(1).type === "ident" && !["contains", "beginsWith", "endsWith", "between"].includes(this.peek(1).value)) {
        const mod = this.peek(1);
        if (!this.isPunct("(", 2) && !expr.modifiers.length) {
          // com.apple.mobilesafari — a dotted name/bundle ID written without quotes.
          let dotted = expr.name;
          while (this.isPunct(".") && this.peek(1).type === "ident") {
            this.next();
            dotted += "." + this.next().value;
          }
          this.error(t, `\`${dotted}\` must be in quotes.`, `Write \`"${dotted}"\` (bundle IDs and other dotted text are strings).`);
          return { k: "string", tok: { ...t, type: "string", value: dotted }, interps: [] };
        }
        this.error(mod, `\`.${mod.value}\` isn't a Jelly modifier.`, "Only `.as(Type)`, `.key(name)` and `.get(Property)` exist; everything else is an action call.");
        this.next();
        this.next();
        if (this.isPunct("(")) this.skipBalanced();
      }
      if (this.isPunct("[") && this.peek().line === t.line) {
        this.next();
        expr.index = this.parseExpr();
        this.expectPunct("]", "to close the index");
      }
      return expr;
    }
    this.error(t, `Expected a value, found ${describe(t)}.`);
    if (!(t.type === "newline" || t.type === "eof" || (t.type === "punct" && ")]},".includes(t.value)))) this.next();
    return { k: "error", tok: t };
  }

  private skipBalanced() {
    let depth = 0;
    while (!this.at("eof")) {
      const t = this.next();
      if (t.type === "punct" && "([{".includes(t.value)) depth++;
      if (t.type === "punct" && ")]}".includes(t.value) && --depth <= 0) return;
    }
  }

  private parseArray(): Expr {
    const open = this.next();
    const items: Expr[] = [];
    while (true) {
      while (this.at("newline") || this.isPunct(",")) this.next();
      if (this.isPunct("]")) {
        this.next();
        break;
      }
      if (this.at("eof") || this.isPunct(")") || this.isPunct("}")) {
        this.error(open, "This `[` is never closed with `]`.");
        break;
      }
      const before = this.pos;
      items.push(this.parseExpr());
      if (this.pos === before) this.next();
    }
    return { k: "array", tok: open, items };
  }

  private parseDict(): Expr {
    const open = this.next();
    let depth = 1;
    while (!this.at("eof") && depth > 0) {
      const t = this.next();
      if (t.type === "punct" && t.value === "{") depth++;
      if (t.type === "punct" && t.value === "}") depth--;
    }
    if (depth > 0) this.error(open, "This `{` is never closed with `}`.");
    return { k: "dict", tok: open };
  }

  /**
   * Reads a bare multi-token enum value as raw text — `File Extension`, `en-US`, `ISO 8601`,
   * `1920x1080`, `Rating (This Version)` — when the action's parameter is an enumeration and the
   * text is a known spelling or plain words. Returns undefined to parse the value normally.
   */
  private enumWords(fn: string, label: string): (Expr & { k: "words" }) | undefined {
    const spellings = new Set<string>();
    let isEnum = false;
    for (const a of findActions(fn)) {
      const p = a.params.find((x) => x.name === label);
      if (p?.enum && (p.type === "Enum" || p.type === "DynamicEnum")) {
        isEnum = true;
        for (const v of enumSpellings(p)) spellings.add(v);
      }
      // Loosely documented shapes (filter sort keys, untyped parameters): the docs write bare
      // multi-word values such as `sortBy: Creation Date`, so don't reject them.
      if (p && LOOSE_TYPES.has(p.type)) isEnum = true;
    }
    if (!isEnum) return undefined;
    let k = 0;
    let depth = 0;
    while (true) {
      const t = this.peek(k);
      if (t.type === "eof" || t.type === "newline" || t.type === "string" || t.type === "mstring" || t.type === "dict") break;
      if (t.type === "punct") {
        if (t.value === "(" || t.value === "[") depth++;
        else if (t.value === ")" || t.value === "]") {
          if (depth === 0) break;
          depth--;
        } else if (t.value === "," && depth === 0) break;
      }
      k++;
    }
    if (k < 2 || depth !== 0) return undefined;
    const first = this.peek();
    const raw = this.src.slice(first.start, this.peek(k - 1).end);
    if (!spellings.has(raw) && !/^[A-Za-z0-9][A-Za-z0-9 '-]* [A-Za-z0-9 '-]*$/.test(raw)) return undefined;
    for (let n = 0; n < k; n++) this.next();
    return { k: "words", tok: first, raw };
  }

  private parseCall(): Expr & { k: "call" } {
    const nameTok = this.next();
    const open = this.next(); // (
    const args: Arg[] = [];
    while (true) {
      while (this.at("newline") || this.isPunct(",")) this.next();
      if (this.isPunct(")")) {
        this.next();
        break;
      }
      if (this.at("eof") || this.isPunct("{") || this.isPunct("}")) {
        this.error(open, `The \`(\` after \`${nameTok.value}\` is never closed with \`)\`.`);
        break;
      }
      const before = this.pos;
      if (this.at("ident") && this.isPunct(":", 1)) {
        const labelTok = this.next();
        this.next();
        if (this.isPunct(",") || this.isPunct(")")) {
          this.warn(labelTok, `\`${labelTok.value}:\` has no value.`, "Give it a value or remove the label.");
          continue;
        }
        args.push({ label: labelTok.value, labelTok, value: this.enumWords(nameTok.value, labelTok.value) ?? this.parseExpr() });
      } else {
        args.push({ value: this.parseExpr() });
      }
      if (this.pos === before) this.next();
      const t = this.peek();
      if (!(t.type === "newline" || (t.type === "punct" && (t.value === "," || t.value === ")")))) {
        this.error(t, `Unexpected ${describe(t)} in the arguments of \`${nameTok.value}\`.`, "Separate arguments with commas: `label: value, other: value`.");
        while (!this.isPunct(",") && !this.isPunct(")") && !this.at("newline") && !this.at("eof")) this.next();
      }
    }
    return { k: "call", tok: nameTok, name: nameTok.value, args };
  }

  // ---- semantic checks ----------------------------------------------------------------------
  /** Checks variable references inside any value. */
  private checkValueExpr(e: Expr, where: "assign" | "arg" | "condition" | "value" | "return") {
    switch (e.k) {
      case "string":
        for (const interp of e.interps) this.checkInterpolation(interp, e.tok);
        return;
      case "ident":
        this.useVariable(e.name, e.tok);
        if (e.index) {
          this.checkValueExpr(e.index, where);
          if (where === "assign" || where === "return") this.info(e.tok, "List indexing (`list[i]`) needs Jellycuts March 2026 or later.", 'Classic form: `getItemFromList(list: items, type: ItemAtIndex, index: "1") >> item`.');
          else this.warn(e.tok, "List indexing only works in `var x = list[i]` assignments.", 'Use `getItemFromList(list: items, type: ItemAtIndex, index: "1") >> item`.');
        }
        return;
      case "call":
        if (where === "assign" || where === "return") {
          this.info(e.tok, "Assigning a call result with `var x = action(…)` needs Jellycuts March 2026 or later.", `Classic form: \`${e.name}(…) >> x\`.`);
        } else {
          this.warn(e.tok, `Calling \`${e.name}\` inside another call's argument may not be supported.`, `Run it on its own line first: \`${e.name}(…) >> value\`, then pass \`value\`.`);
        }
        this.checkCall(e);
        return;
      case "array":
        for (const item of e.items) this.checkValueExpr(item, where);
        if (where === "assign") this.info(e.tok, "List literals in `var x = [ … ]` need Jellycuts March 2026 or later.", 'Classic form: `list(items: ["a", "b"]) >> x`.');
        return;
      case "binary":
        this.checkValueExpr(e.left, where);
        this.checkValueExpr(e.right, where);
        if (where === "assign" || where === "return") this.info(e.tok, "Math in assignments needs Jellycuts March 2026 or later.", 'Classic form: `calculate(input: "${a} + ${b}") >> total`.');
        else this.warn(e.tok, "Math isn't evaluated inside arguments or conditions.", 'Use `calculate(input: "${a} + 1") >> result` first.');
        return;
      case "dict":
        if (where !== "arg") this.warn(e.tok, "Inline `{ … }` dictionaries aren't supported here.", 'Use `dictionary(json: {"key": "value"}) >> dict`.');
        return;
      case "words":
        this.error(e.tok, `\`${e.raw}\` — names can't contain spaces.`, "If it's text, put it in quotes.");
        return;
      default:
        return;
    }
  }

  private checkInterpolation(interp: Interpolation, stringTok: Token) {
    const text = interp.text;
    if (!text) {
      this.error(stringTok, "Empty `${}` in a string.");
      return;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_$]*)/.exec(text);
    if (!m) {
      this.warn(stringTok, `\`\${${text}}\` — only variable names (optionally with .as/.key/.get) can go inside \${ }.`, "Compute the value first and capture it with `>>`.");
      return;
    }
    const v2 = V2_NAMES[text.toLowerCase().replace(/\s+\d+$/, "")];
    if (v2 && /\s/.test(text)) {
      this.error(stringTok, `\`\${${text}}\` uses the old Jelly 2 spelling.`, `Write \`\${${v2}}\`.`);
      return;
    }
    const rest = text.slice(m[1].length).trim();
    if (rest && !/^(\.(as|get|key)\([^()]*\))+$/.test(rest.replace(/\s+/g, ""))) {
      if (/^\s*[+\-*/]/.test(rest)) {
        this.warn(stringTok, `Math inside \`\${${text}}\` isn't evaluated.`, `Use \`calculate(input: "\${...}")\` first and interpolate its output.`);
      } else if (/^[A-Za-z]/.test(rest)) {
        this.error(stringTok, `\`\${${text}}\` — variable names can't contain spaces.`);
        return;
      } else {
        this.warn(stringTok, `\`\${${text}}\` — only a variable name with optional .as()/.key()/.get() works inside \${ }.`);
      }
    }
    this.useVariable(m[1], { ...stringTok, line: interp.line, col: interp.col });
  }

  private checkCall(call: Expr & { k: "call" }) {
    const name = call.name;
    const t = call.tok;
    const userDef = this.definedFuncs.get(name);
    if (userDef) return this.checkUserCall(call, userDef);
    const later = this.allDefs.get(name);
    if (later) {
      this.error(t, `\`${name}\` is called before its ${later.kind} is declared (line ${later.line}).`, `Move the \`${later.kind} ${name}\` block above this line.`);
      return this.checkUserCall(call, later);
    }
    if (["if", "repeat", "repeatEach", "menu", "func", "macro"].includes(name)) {
      this.error(t, `\`${name}\` can't be used as a value.`);
      return;
    }
    const candidates = findActions(name);
    if (!candidates.length) {
      const sugg = suggestActions(name, [...this.definedFuncs.keys()]);
      this.error(
        t,
        `Unknown action \`${name}\`.`,
        (sugg.length ? `Did you mean ${sugg.map((s) => `\`${s}\``).join(", ")}? ` : "") + "Use search_actions to find the right one.",
      );
      for (const a of call.args) this.checkValueExpr(a.value, "arg");
      return;
    }
    const imported = candidates.filter((a) => this.imports.has(a.library));
    let action: Action;
    if (imported.length) {
      // When several imported libraries define the name, the first import wins.
      imported.sort((a, b) => this.imports.get(a.library)! - this.imports.get(b.library)!);
      action = imported[0];
      if (imported.length > 1) {
        const labels = call.args.map((a) => a.label).filter(Boolean) as string[];
        const fits = (a: Action) => labels.every((l) => a.params.some((p) => p.name === l));
        const better = imported.slice(1).find((a) => fits(a) && !fits(action));
        if (better) {
          this.error(
            t,
            `\`${name}\` exists in both ${action.library} and ${better.library}; ${action.library} is imported first, so its version is used — but these labels match ${better.library}'s.`,
            `Move \`import ${better.library}\` above \`import ${action.library}\`.`,
          );
          action = better;
        } else {
          this.info(t, `\`${name}\` exists in ${imported.map((a) => a.library).join(" and ")}; the first import (${action.library}) wins.`);
        }
      }
    } else {
      action = candidates.find((a) => a.library === "Shortcuts") ?? candidates[0];
      const lib = action.library;
      this.error(
        t,
        `\`${name}\` comes from the ${lib} library, which isn't imported${this.imports.size ? "" : " (no imports at all)"}.`,
        `Add \`import ${lib}\` at the top of the script.`,
      );
    }
    this.actionCalls++;
    this.checkArgs(call, action);
  }

  private checkUserCall(call: Expr & { k: "call" }, def: FuncDef) {
    const labelled = call.args.filter((a) => a.label);
    const unlabelled = call.args.filter((a) => !a.label);
    if (unlabelled.length && def.params.length) {
      this.warn(
        call.tok,
        `Arguments to \`${def.name}\` should be labelled.`,
        `Write \`${def.name}(${def.params.map((p) => `${p}: …`).join(", ")})\`.`,
      );
    }
    for (const a of labelled) {
      if (!def.params.includes(a.label!)) {
        this.error(a.labelTok!, `\`${def.name}\` has no parameter \`${a.label}\`.`, def.params.length ? `Its parameters are: ${def.params.join(", ")}.` : `\`${def.name}\` takes no parameters.`);
      }
    }
    if (call.args.length > def.params.length) this.warn(call.tok, `\`${def.name}\` takes ${def.params.length} parameter(s) but got ${call.args.length}.`);
    for (const p of def.params) {
      if (!call.args.some((a) => a.label === p) && unlabelled.length === 0) this.warn(call.tok, `Missing argument \`${p}\` for \`${def.name}\`.`);
    }
    for (const a of call.args) this.checkValueExpr(a.value, "arg");
  }

  private checkArgs(call: Expr & { k: "call" }, action: Action) {
    const seen = new Set<string>();
    const labels = action.params.map((p) => p.name);
    const usage = `${action.name}(${action.params.map((p) => `${p.name}: …`).join(", ")})`;
    for (const arg of call.args) {
      if (!arg.label) {
        const only = action.params.length === 1 ? action.params[0].name : undefined;
        this.error(
          arg.value.tok,
          `Arguments must be labelled in Jelly 3 (\`${action.name}\`).`,
          only ? `Write \`${action.name}(${only}: …)\`.` : action.params.length ? `Labels: ${labels.join(", ")} — e.g. \`${usage}\`.` : `\`${action.name}\` takes no arguments: \`${action.name}()\`.`,
        );
        this.checkValueExpr(arg.value, "arg");
        continue;
      }
      if (seen.has(arg.label)) this.error(arg.labelTok!, `\`${arg.label}\` is given twice.`);
      seen.add(arg.label);
      const param = action.params.find((p) => p.name === arg.label);
      if (!param) {
        if (!action.params.length) {
          this.warn(arg.labelTok!, `\`${action.name}\` doesn't take parameters (per the docs).`, `Call it as \`${action.name}()\`.`);
        } else {
          const ci = labels.find((l) => l.toLowerCase() === arg.label!.toLowerCase());
          const sugg = ci ? [ci] : closest(arg.label, labels);
          this.error(
            arg.labelTok!,
            `\`${action.name}\` has no parameter \`${arg.label}\` — it would be silently ignored.`,
            (sugg.length ? `Did you mean \`${sugg[0]}\`? ` : "") + `Valid labels: ${labels.join(", ")}.`,
          );
        }
        this.checkValueExpr(arg.value, "arg");
        continue;
      }
      this.checkParamValue(action, param, arg.value);
      if (arg.value.k === "dict" && arg !== call.args[call.args.length - 1]) {
        this.warn(
          arg.value.tok,
          `Put \`${arg.label}:\` last in the call.`,
          "In the Jellycuts app a `{ … }` value that it can't read swallows the arguments after it; keeping it last keeps them safe.",
        );
      }
    }
    // Only the Shortcuts library marks optional parameters in its docs.
    if (action.library === "Shortcuts") {
      for (const p of action.params) {
        if (!p.optional && !seen.has(p.name) && call.args.every((a) => a.label)) {
          this.warn(call.tok, `\`${action.name}\` is missing \`${p.name}\` (${describeParam(p)}).`, `Add \`${p.name}: …\` — otherwise Jellycuts uses an empty/default value.`);
        }
      }
    }
  }

  private checkParamValue(action: Action, param: Param, value: Expr) {
    const values = enumValues(param);
    const where = `\`${param.name}\` of \`${action.name}\``;
    if ((param.type === "Enum" || param.type === "DynamicEnum") && values) {
      const spelling = value.k === "words" ? value.raw : value.k === "ident" && !value.modifiers.length && !value.index ? value.name : undefined;
      if (spelling !== undefined) {
        if (values.includes(spelling)) return;
        const alias = enumAlias(param, spelling);
        if (alias?.status === "confirmed") return;
        if (alias?.status === "docs") {
          this.warn(value.tok, `The docs write \`${spelling}\` here, but Shortcuts spells it \`${alias.to}\`.`, `Write \`${param.name}: ${alias.to}\`.`);
          return;
        }
        if (alias) {
          // The app reads the real value; the compiler's identifier is taken for a variable name.
          this.error(
            value.tok,
            `\`${spelling}\` isn't how Jellycuts spells this value — the app reports "The variable ${spelling} does not exist in the scope".`,
            `Write \`${param.name}: ${alias.to}\` (spaces included, no quotes).`,
          );
          return;
        }
        if (value.k === "ident" && (this.lookup(value.name) || LOOP_VAR.test(value.name))) {
          if (param.type === "Enum") this.warn(value.tok, `${where} expects one of its fixed values; a variable may not work here.`, `Values: ${values.join(", ")}.`);
          return;
        }
        if (param.type === "DynamicEnum" && value.k === "words") return; // free text is allowed for dynamic enums
        const loose = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
        const near = values.find((v) => loose(v) === loose(spelling));
        const sugg = near ? [near] : closest(spelling, values);
        if (param.type === "DynamicEnum" && !near) return;
        this.error(value.tok, `\`${spelling}\` isn't a valid value for ${where}.`, (sugg.length ? `Did you mean \`${sugg[0]}\`? ` : "") + `Valid: ${values.join(", ")}.`);
        return;
      }
      if (value.k === "string" && !value.interps.length) {
        const text = value.tok.value;
        const hit = values.find((v) => v === text) ?? enumAlias(param, text)?.to ?? values.find((v) => v.toLowerCase() === text.toLowerCase());
        if (param.type === "DynamicEnum" && !hit) return; // free text is allowed for dynamic enums
        this.error(value.tok, `${where} takes a bare value, not a quoted string.`, hit ? `Write \`${param.name}: ${hit}\` (no quotes).` : `Valid: ${values.join(", ")}.`);
        return;
      }
      if (value.k === "number" && param.type === "DynamicEnum") return;
      this.checkValueExpr(value, "arg");
      return;
    }
    switch (param.type) {
      case "Boolean":
      case "BoolNumb":
        if (value.k === "string") {
          const v = value.tok.value.toLowerCase();
          if (v === "true" || v === "false") this.error(value.tok, `${where} takes \`true\` or \`false\` without quotes.`);
          return;
        }
        if (value.k === "number" && param.type === "BoolNumb") return;
        if (value.k === "ident" && /^(yes|no|on|off)$/i.test(value.name)) {
          this.error(value.tok, `${where} takes \`true\` or \`false\`.`);
          return;
        }
        break;
      case "Time Span":
      case "Measurement Quantity":
        if (value.k === "number") {
          this.error(value.tok, `${where} needs a unit, in quotes.`, `Write \`${param.name}: "${value.tok.value} min"\` (sec, min, hr, days, weeks…).`);
          return;
        }
        if (value.k === "string" && !value.interps.length && !/^\s*-?\d+(\.\d+)?\s+[A-Za-z]+\s*$/.test(value.tok.value)) {
          this.warn(value.tok, `${where} should look like "10 min", "2 hours" or "30 sec".`);
          return;
        }
        break;
      case "Dictionary":
        return this.checkDictionary(action, param, value);
      case "Variable":
      case "Variable Array":
        if (value.k === "string" || value.k === "number" || value.k === "array") {
          this.warn(value.tok, `${where} expects a variable or output, not a literal.`, "Create the value first (e.g. `text(text: \"…\") >> name`) and pass `name`.");
          if (value.k === "string") for (const i of value.interps) this.checkInterpolation(i, value.tok);
          return;
        }
        break;
      case "Array":
        if (value.k === "string" && !value.interps.length) {
          this.warn(value.tok, `${where} expects a list like \`["a", "b"]\`.`);
          return;
        }
        break;
      case "Unknown":
      case "Literal":
      case "Object":
      case "Filter":
      case "Filter Type":
      case "Order":
      case "Sort":
        // Undocumented/special shapes — don't second-guess; just check variable references inside strings.
        if (value.k === "string") for (const i of value.interps) this.checkInterpolation(i, value.tok);
        return;
    }
    this.checkValueExpr(value, "arg");
  }

  /**
   * Dictionary parameters, using what the Jellycuts app confirmed (data/app-confirmed.json):
   * dictionary(json:) takes plain JSON in braces, downloadURL's headers takes JSON in braces with
   * escaped quotes, and neither accepts JSON inside a quoted string.
   */
  private checkDictionary(action: Action, param: Param, value: Expr) {
    const rule = dictionaryRule(action, param);
    const want = rule.accepted[0];
    const where = `\`${param.name}\` of \`${action.name}\``;
    const asWanted = (json: string) => `Write \`${param.name}: ${writeDict(json, want)}\``;
    if (value.k === "string") {
      const json = value.tok.value.replace(/\\"/g, '"').trim();
      this.error(
        value.tok,
        `JSON in a quoted string doesn't work for ${where} — the app reports "Unable to find valid JSON".`,
        json.startsWith("{") && !value.interps.length ? `${asWanted(json)} (no quotes around the braces).` : `${asWanted('{"key": "value"}')} (no quotes around the braces).`,
      );
      return;
    }
    if (value.k !== "dict") {
      if (value.k === "ident" && !this.lookup(value.name)) this.checkValueExpr(value, "arg");
      else if (value.k === "ident") {
        this.warn(value.tok, `${where} takes the JSON itself; a variable isn't accepted here.`, `${asWanted('{"key": "value"}')}. To put variables into JSON, build it with dictionary(json:) + setValue.`);
      } else this.checkValueExpr(value, "arg");
      return;
    }
    const raw = value.tok.value;
    if (raw.includes("${")) {
      this.error(
        value.tok,
        `Variables don't work inside JSON for ${where} — the \`\${…}\` would be sent as literal text.`,
        'Build the dictionary first: `dictionary(json: {"key": ""}) >> d`, then `setValue(key: "key", value: "${name}", dictionary: d) >> filled`, and pass `filled`.',
      );
      return;
    }
    // Plain JSON parses as it is; the escaped form parses once every \\" becomes ".
    const parses = (text: string) => {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    };
    const hasQuotes = raw.includes('"');
    const form: DictForm | undefined = !hasQuotes ? undefined : parses(raw) ? "plain" : !/(^|[^\\])"/.test(raw) && parses(raw.replace(/\\"/g, '"')) ? "escaped" : undefined;
    if (hasQuotes ? !form : !parses(raw)) {
      this.error(
        value.tok,
        `This isn't valid JSON — the app reports "Unable to find valid JSON".`,
        `Quote every key and text value, using one kind of quote throughout: ${asWanted('{"key": "value"}')}.`,
      );
      return;
    }
    if (!form || rule.accepted.includes(form)) return;
    if (rule.rejected.includes(form)) {
      this.error(
        value.tok,
        `${where} needs ${want === "escaped" ? "every quote inside the braces escaped as \\\"" : "plain quotes inside the braces"} — written this way the app reports "Unable to find valid JSON".`,
        `${asWanted(raw)}.`,
      );
      return;
    }
    this.warn(
      value.tok,
      `This way of writing ${where} hasn't been confirmed in the Jellycuts app.`,
      rule.confirmed ? `${asWanted(raw)} — the form the app accepts here.` : `${asWanted(raw)} — the form \`downloadURL\`'s headers needs, which the app accepts.`,
    );
  }

  private finalChecks() {
    if (!this.tokens.some((t) => t.type !== "newline" && t.type !== "eof")) {
      this.report("error", 1, 1, "The script is empty.");
      return;
    }
    if (!this.imports.has("Shortcuts")) {
      this.report(
        "warning",
        1,
        1,
        "There is no `import Shortcuts` line.",
        "Start the script with `import Shortcuts` so the built-in actions are available.",
      );
    }
  }
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function describe(t: Token): string {
  switch (t.type) {
    case "newline":
      return "the end of the line";
    case "eof":
      return "the end of the script";
    case "string":
    case "mstring":
      return "a string";
    case "dict":
      return "a `{ … }` value";
    case "number":
      return `\`${t.value}\``;
    default:
      return `\`${t.value}\``;
  }
}

function describeParam(p: Param): string {
  if (p.enum) return `one of ${p.enum}`;
  return p.type.toLowerCase();
}

export function validateJelly(source: string): ValidationResult {
  return new Validator(source).run();
}

export function formatValidation(result: ValidationResult, options: { maxItems?: number } = {}): string {
  const max = options.maxItems ?? 40;
  const infos = result.diagnostics.filter((d) => d.severity === "info").length;
  const head = result.ok
    ? `✅ No errors found${result.warnings ? ` (${result.warnings} warning${result.warnings === 1 ? "" : "s"})` : ""}.`
    : `❌ ${result.errors} error${result.errors === 1 ? "" : "s"}${result.warnings ? `, ${result.warnings} warning${result.warnings === 1 ? "" : "s"}` : ""} — fix the errors before sharing.`;
  const lines = [head];
  const shown = result.diagnostics.slice(0, max);
  for (const d of shown) {
    const icon = d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "note";
    lines.push(`- line ${d.line}:${d.col} ${icon}: ${d.message}${d.fix ? ` → ${d.fix}` : ""}`);
  }
  if (result.diagnostics.length > max) lines.push(`… and ${result.diagnostics.length - max} more.`);
  lines.push(
    `(${result.stats.lines} lines, ${result.stats.actions} action call${result.stats.actions === 1 ? "" : "s"}` +
      `${result.stats.imports.length ? `, imports: ${result.stats.imports.join(", ")}` : ""}${infos ? `, ${infos} note${infos === 1 ? "" : "s"}` : ""}.` +
      " This is a static check — the Jellycuts app has the final say.)",
  );
  return lines.join("\n");
}
