// Tokenizer for Jelly source. Tolerant: it never throws, it records problems instead.

export type TokenType = "ident" | "number" | "string" | "mstring" | "punct" | "newline" | "eof";

export interface Interpolation {
  /** Source text between `${` and `}`. */
  text: string;
  line: number;
  col: number;
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
  /** For strings: decoded text segments are not needed, only the interpolations. */
  interpolations?: Interpolation[];
}

export interface LexProblem {
  line: number;
  col: number;
  message: string;
  severity: "error" | "warning";
  fix?: string;
}

const PUNCTUATION = [
  "...",
  ">>",
  "+=",
  "-=",
  "==",
  "!=",
  "<=",
  ">=",
  "::",
  "!:",
  "$$",
  "$!",
  "&&",
  "||",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ",",
  ":",
  ".",
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "^",
  "!",
  "#",
  ";",
  "?",
  "@",
  "&",
  "|",
  "'",
  "`",
  "~",
];

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c);

export function lex(source: string): { tokens: Token[]; problems: LexProblem[] } {
  const tokens: Token[] = [];
  const problems: LexProblem[] = [];
  let src = source.replace(/\r\n?/g, "\n");
  // iOS "Smart Punctuation" turns quotes curly when code is typed or pasted on a phone.
  const curlyLines = new Set<number>();
  src.split("\n").forEach((text, n) => {
    if (/[“”‘’]/.test(text)) curlyLines.add(n + 1);
  });
  for (const n of [...curlyLines].slice(0, 3)) {
    problems.push({
      line: n,
      col: 1,
      severity: "error",
      message: "Curly quotes (“ ” or ‘ ’) found — Jelly needs straight quotes (\").",
      fix: "Replace smart quotes with straight quotes. On iPhone, Settings › General › Keyboard › Smart Punctuation causes this.",
    });
  }
  src = src.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n = 1) => {
    for (let k = 0; k < n && i < src.length; k++) {
      if (src[i] === "\n") {
        line++;
        col = 1;
      } else col++;
      i++;
    }
  };

  /** Reads a string body starting after the opening delimiter, reporting unterminated strings. */
  const readString = (multi: boolean, startLine: number, startCol: number): Token => {
    const interpolations: Interpolation[] = [];
    let value = "";
    let closed = false;
    let warnedNewline = false;
    while (i < src.length) {
      if (multi && src.startsWith('"""', i)) {
        advance(3);
        closed = true;
        break;
      }
      const c = src[i];
      if (!multi && c === '"') {
        advance();
        closed = true;
        break;
      }
      if (c === "\\") {
        value += c + (src[i + 1] ?? "");
        advance(2);
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        const iLine = line;
        const iCol = col;
        advance(2);
        let text = "";
        let depth = 0;
        while (i < src.length && !(src[i] === "}" && depth === 0)) {
          if (src[i] === "\n" && !multi) break;
          if (src[i] === "(") depth++;
          if (src[i] === ")") depth = Math.max(0, depth - 1);
          text += src[i];
          advance();
        }
        if (src[i] === "}") {
          advance();
          interpolations.push({ text: text.trim(), line: iLine, col: iCol });
          value += "${" + text + "}";
        } else {
          problems.push({
            line: iLine,
            col: iCol,
            severity: "error",
            message: "`${` is never closed with `}` inside this string.",
          });
        }
        continue;
      }
      if (c === "\n" && !multi && !warnedNewline) {
        warnedNewline = true;
        problems.push({
          line: startLine,
          col: startCol,
          severity: "error",
          message: "This string runs past the end of the line — a closing `\"` is probably missing.",
          fix: 'Close the string on the same line, or use """ … """ for multi-line text.',
        });
        // Recover: treat the line end as the end of the string.
        break;
      }
      value += c;
      advance();
    }
    if (!closed && !warnedNewline) {
      problems.push({
        line: startLine,
        col: startCol,
        severity: "error",
        message: multi ? 'Multi-line string opened with """ is never closed.' : 'String is never closed with `"`.',
      });
    }
    return { type: multi ? "mstring" : "string", value, line: startLine, col: startCol, interpolations };
  };

  while (i < src.length) {
    const c = src[i];
    const startLine = line;
    const startCol = col;

    if (c === "\n") {
      tokens.push({ type: "newline", value: "\n", line, col });
      advance();
      continue;
    }
    if (c === " " || c === "\t" || c === " ") {
      advance();
      continue;
    }
    if (src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") advance();
      continue;
    }
    if (src.startsWith("/*", i)) {
      advance(2);
      while (i < src.length && !src.startsWith("*/", i)) advance();
      if (i >= src.length) {
        problems.push({ line: startLine, col: startCol, severity: "error", message: "Block comment `/*` is never closed with `*/`." });
      } else advance(2);
      continue;
    }
    if (src.startsWith('"""', i)) {
      advance(3);
      tokens.push(readString(true, startLine, startCol));
      continue;
    }
    if (c === '"') {
      advance();
      tokens.push(readString(false, startLine, startCol));
      continue;
    }
    if (/[0-9]/.test(c)) {
      let v = "";
      while (i < src.length && /[0-9.]/.test(src[i])) {
        if (src[i] === "." && !/[0-9]/.test(src[i + 1] ?? "")) break;
        v += src[i];
        advance();
      }
      tokens.push({ type: "number", value: v, line: startLine, col: startCol });
      continue;
    }
    if (isIdentStart(c)) {
      let v = "";
      while (i < src.length && isIdentPart(src[i])) {
        // `$$` and `$!` are operators even when glued to a name.
        if (src[i] === "$" && (src[i + 1] === "$" || src[i + 1] === "!")) break;
        v += src[i];
        advance();
      }
      tokens.push({ type: "ident", value: v, line: startLine, col: startCol });
      continue;
    }
    const p = PUNCTUATION.find((op) => src.startsWith(op, i));
    if (p) {
      tokens.push({ type: "punct", value: p, line: startLine, col: startCol });
      advance(p.length);
      continue;
    }
    problems.push({ line, col, severity: "error", message: `Unexpected character \`${c}\`.` });
    advance();
  }
  tokens.push({ type: "eof", value: "", line, col });
  return { tokens, problems };
}
