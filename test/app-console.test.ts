// Ground truth from the Jellycuts app itself.
//
// Each fixture in test/fixtures/app-console/ is a script that was built in the Jellycuts iOS app
// (October 2026). `appErrors` lists the lines the app's console reported as errors, with the
// app's own message. validate_jelly must flag exactly those lines and nothing else, so a script
// that passes here builds in the app and a script the app rejects never passes.

/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { validateJelly } from "../src/jelly/validate";

const FIXTURES = import.meta.glob("./fixtures/app-console/*.jelly", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const fixture = (name: string) => {
  const code = FIXTURES[`./fixtures/app-console/${name}`];
  if (code === undefined) throw new Error(`Missing fixture ${name}`);
  return code;
};

interface AppRun {
  file: string;
  /** What the app's console printed, line number → error message. */
  appErrors: Record<number, string>;
  /** True when the expectation is a prediction from other app results, not a build of this exact file. */
  predicted?: boolean;
}

const RUNS: AppRun[] = [
  {
    // JSON written as a quoted string (what the connector's guide used to teach).
    file: "reader-quoted-json.jelly",
    appErrors: {
      18: "Unable to find valid JSON",
      51: "Unable to find valid JSON",
      54: "The variable FileExtension does not exist in the scope",
    },
  },
  {
    // Bare {…} JSON: fine for dictionary(json:), rejected for downloadURL headers (two keys).
    file: "reader-plain-headers-two-keys.jelly",
    appErrors: { 51: "Unable to find valid JSON" },
  },
  {
    // One-key bare headers in the middle of the arguments.
    file: "reader-plain-headers-middle.jelly",
    appErrors: { 49: "Unable to find valid JSON" },
  },
  {
    // One-key bare headers as the last argument: still rejected, so position isn't the cause.
    file: "reader-plain-headers-last.jelly",
    appErrors: { 48: "Unable to find valid JSON" },
  },
  {
    // One line per JSON form.
    file: "json-probe.jelly",
    appErrors: {
      6: "Unable to find valid JSON",
      7: "Unable to find valid JSON",
      9: "Unable to find valid JSON",
      10: "Unable to find valid JSON",
    },
  },
  {
    // headers with backslash-escaped quotes, the form json-probe.jelly line 8 showed the app accepts.
    file: "reader-escaped-headers.jelly",
    appErrors: {},
    predicted: true,
  },
];

describe("validate_jelly agrees with the Jellycuts app", () => {
  for (const run of RUNS) {
    it(`${run.file}${run.predicted ? " (predicted)" : ""}`, () => {
      const result = validateJelly(fixture(run.file));
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      const byLine = new Map<number, string[]>();
      for (const e of errors) byLine.set(e.line, [...(byLine.get(e.line) ?? []), `${e.message} ${e.fix ?? ""}`]);

      expect([...byLine.keys()].sort((a, b) => a - b), errors.map((e) => `line ${e.line}: ${e.message}`).join("\n")).toEqual(
        Object.keys(run.appErrors).map(Number).sort((a, b) => a - b),
      );
      for (const [line, appMessage] of Object.entries(run.appErrors)) {
        // Our message quotes the app's wording so Claude can match a pasted console line to the fix.
        expect(byLine.get(Number(line))!.join("\n")).toContain(appMessage);
      }
    });
  }
});

describe("forms the app confirmed", () => {
  const errorsIn = (code: string) => validateJelly(`import Shortcuts\n${code}`).diagnostics.filter((d) => d.severity === "error");

  it.each([
    ["plain JSON in dictionary(json:)", 'dictionary(json: {"model_id": "abc"}) >> d'],
    ["dashes in a JSON key", 'dictionary(json: {"xi-api-key": "abc"}) >> d'],
    ["two keys in dictionary(json:)", 'dictionary(json: {"a": "b", "c": "d"}) >> d'],
    ["escaped JSON in headers", 'downloadURL(url: "https://example.com", headers: {\\"xi-api-key\\": \\"abc\\"}) >> r'],
    ["a two-word setting value", "fileDetail(input: ShortcutInput, property: File Extension) >> ext"],
    ["exit with a value", "exit(var: ShortcutInput)"],
  ])("accepts %s", (_name, code) => {
    expect(errorsIn(code).map((e) => e.message)).toEqual([]);
  });

  it.each([
    ["JSON inside a quoted string", 'dictionary(json: "{\\"a\\": \\"b\\"}") >> d', "Unable to find valid JSON"],
    ["plain JSON in headers", 'downloadURL(url: "https://example.com", headers: {"Accept": "abc"}) >> r', "Unable to find valid JSON"],
    ["a setting value with its spaces removed", "fileDetail(input: ShortcutInput, property: FileExtension) >> ext", "The variable FileExtension does not exist in the scope"],
  ])("rejects %s with the app's message", (_name, code, appMessage) => {
    const errors = errorsIn(code);
    expect(errors.map((e) => e.message).join("\n")).toContain(appMessage);
  });

  it("tells Claude the exact replacement", () => {
    const [fileExt] = errorsIn("fileDetail(input: ShortcutInput, property: FileExtension) >> ext");
    expect(fileExt.fix).toContain("property: File Extension");
    const [headers] = errorsIn('downloadURL(url: "https://example.com", headers: {"Accept": "abc"}) >> r');
    expect(headers.fix).toContain('{\\"Accept\\": \\"abc\\"}');
    const [quoted] = errorsIn('dictionary(json: "{\\"a\\": \\"b\\"}") >> d');
    expect(quoted.fix).toContain('{"a": "b"}');
  });
});
