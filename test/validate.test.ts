import { describe, expect, it } from "vitest";
import { GUIDE_SECTIONS } from "../src/guide";
import { type Diagnostic, validateJelly } from "../src/jelly/validate";

const errors = (code: string) => validateJelly(code).diagnostics.filter((d) => d.severity === "error");
const warnings = (code: string) => validateJelly(code).diagnostics.filter((d) => d.severity === "warning");
const messages = (ds: Diagnostic[]) => ds.map((d) => `${d.message} ${d.fix ?? ""}`).join("\n");

describe("valid scripts", () => {
  // Every one of these compiles with the open-source Jelly compiler (Open-Jellycore).
  const scripts: Record<string, string> = {
    hello: `import Shortcuts
#Color: blue, #Icon: star

// Ask for a name and greet the user
askForInput(prompt: "What's your name?", type: Text) >> name
alert(alert: "Hello, \${name}!", title: "Hi there")`,
    battery: `import Shortcuts
#Color: green, #Icon: battery

batteryLevel() >> level
if level < 20 {
    lowPowerMode(state: true)
    sendNotification(body: "Battery is at \${level}%. Low Power Mode is on.", title: "Battery")
} else {
    showResult(text: "Battery is fine: \${level}%")
}`,
    api: `import Shortcuts
urlContents(url: "https://api.github.com/repos/apple/swift") >> response
getDictionaryFrom(input: response) >> repo
valueFor(key: "stargazers_count", dictionary: repo) >> stars
showResult(text: "Swift has \${stars} stars on GitHub")`,
    loops: `import Shortcuts
list(items: ["Milk", "Eggs", "Bread"]) >> groceries
repeatEach(groceries) {
    sendNotification(body: "Buy \${RepeatItem}", title: "Item \${RepeatIndex}")
}
repeat(3) {
    vibrate()
    wait(seconds: 1)
}
count(type: Items, input: groceries) >> total`,
    menu: `import Shortcuts
menu "What are you drinking?" {
case "Coffee":
    var drink = "Coffee"
case "Water":
    var drink = "Water"
}
showResult(text: "Logged \${drink}")`,
    dates_and_json: `import Shortcuts
formatDate(date: "\${CurrentDate}", dStyle: Long, tStyle: Short) >> today
list(items: ["Red", "Green", "Blue"]) >> colors
choose(list: colors, prompt: "Pick a color") >> picked
dictionary(json: "{\\"day\\": \\"\${today}\\", \\"color\\": \\"\${picked}\\"}") >> entry
valueFor(key: "color", dictionary: entry) >> chosen
adjustDate(operation: Add, duration: "10 min", date: "\${CurrentDate}") >> later
var note = "Today is \${today}. Favorite color: \${chosen}"
showResult(text: note)`,
    input_and_nil: `import Shortcuts
getTextFrom(input: ShortcutInput) >> inputText
if inputText == nil {
    getClipboard() >> clip
    var source = clip
} else {
    var source = inputText
}
changeCase(text: "\${source}", case: uppercase) >> loud
setClipboard(variable: loud)
var asText = ShortcutInput.as(Text)
var name = ShortcutInput.as(Dictionary).key(name)
hideApp(app: "com.apple.mobilesafari")`,
    functions: `import Shortcuts
func greet(name) {
    text(text: "Hello, \${name}!") >> greeting
    return greeting
}
macro shout(words) {
    changeCase(text: "\${words}", case: uppercase) >> upper
    return upper
}
greet(name: "Ada") >> message
shout(words: message) >> loud
showResult(text: loud)`,
  };

  for (const [name, code] of Object.entries(scripts)) {
    it(`accepts ${name}`, () => {
      const result = validateJelly(code);
      expect(messages(result.diagnostics.filter((d) => d.severity !== "info"))).toBe("");
      expect(result.ok).toBe(true);
    });
  }

  it("accepts every jelly snippet in the guide (no errors)", () => {
    for (const section of GUIDE_SECTIONS) {
      for (const [, snippet] of section.body.matchAll(/```jelly\n([\s\S]*?)```/g)) {
        // Snippets are fragments; real scripts start with the import.
        const block = snippet.startsWith("import ") ? snippet : `import Shortcuts\n${snippet}`;
        expect(messages(errors(block)), `guide section "${section.id}":\n${block}`).toBe("");
      }
    }
  });

  it("accepts newer (March 2026) expression syntax with notes only", () => {
    const result = validateJelly(`import Shortcuts
var adjectives = ["Quick", "Happy", "Bright"]
var randomIndex = 1
var selected = adjectives[randomIndex]
var emphasis = randomIndex + 2
func add40(input: int) {
    return input + 40
}`);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "info")).toBe(true);
  });
});

describe("catches common mistakes", () => {
  const cases: [string, string, RegExp][] = [
    ["unknown action with suggestion", `import Shortcuts\nshowNotification(body: "hi")`, /Unknown action `showNotification`[\s\S]*sendNotification/],
    ["unlabelled arguments", `import Shortcuts\ntext(text: "x") >> t\nquicklook(t)`, /must be labelled[\s\S]*quicklook\(input:/],
    ["wrong label", `import Shortcuts\nalert(message: "hi")`, /no parameter `message`/],
    ["wrong enum casing", `import Shortcuts\nchangeCase(text: "hi", case: UPPERCASE)`, /`UPPERCASE` isn't a valid value[\s\S]*uppercase/],
    ["quoted enum", `import Shortcuts\naskForInput(prompt: "Age?", type: "Number")`, /bare word/],
    ["enum with spaces", `import Shortcuts\nlist(items: ["a"]) >> l\ngetItemFromList(list: l, type: Item at Index, index: "1")`, /can't contain spaces/],
    ["missing library import", `import Shortcuts\ngetValue(keyPath: "x")`, /DataJar library, which isn't imported/],
    ["unknown library", `import Shortcutz`, /Unknown library `Shortcutz`/],
    ["else if", `import Shortcuts\nvar a = 1\nif a == 1 {\n} else if a == 2 {\n}`, /`else if` isn't supported/],
    ["&& in conditions", `import Shortcuts\nvar a = 1\nvar b = 2\nif a == 1 && b == 2 {\n}`, /`&&` doesn't work/],
    ["unclosed block", `import Shortcuts\nrepeat(2) {\n  vibrate()\n`, /never closed with `}`/],
    ["unterminated string", `import Shortcuts\nalert(alert: "oops)\nvibrate()`, /closing `"` is probably missing/],
    ["curly quotes", `import Shortcuts\nalert(alert: “hi”)`, /Curly quotes/],
    ["Jelly 2 global names", `import Shortcuts\nvar x = Shortcut Input`, /`Shortcut Input` is the old Jelly 2 spelling[\s\S]*ShortcutInput/],
    ["unquoted time span", `import Shortcuts\ntimer(duration: 10 min)`, /needs a unit, in quotes/],
    ["invalid JSON", `import Shortcuts\ndictionary(json: "{name: 1}")`, /JSON .* isn't valid/],
    ["func used before declaration", `import Shortcuts\nhelper(x: 1)\nfunc helper(x) {\n  return x\n}`, /called before its func is declared/],
    ["assigning to an output", `import Shortcuts\nbatteryLevel() >> level\nlevel = 5`, /read-only/],
    ["assigning to a built-in", `import Shortcuts\nShortcutInput = "x"`, /built-in variable/],
    ["foreign loop", `import Shortcuts\nwhile (true) {\n}`, /no while loop/],
    ["let instead of var", `import Shortcuts\nlet x = 1`, /`let` is not Jelly/],
    ["return outside func", `import Shortcuts\nreturn 1`, /only works inside a func or macro/],
    ["menu without cases", `import Shortcuts\nmenu "Pick" {\n}`, /no cases/],
    ["unquoted bundle id", `import Shortcuts\nhideApp(app: com.apple.mobilesafari)`, /must be in quotes/],
    ["bad cast type", `import Shortcuts\nvar t = ShortcutInput.as(String)`, /isn't a known type/],
    ["spaces in output name", `import Shortcuts\nbatteryLevel() >> battery level`, /can't contain spaces/],
    ["unmatched closing brace", `import Shortcuts\nvibrate()\n}`, /Unmatched `}`/],
    ["flag casing", `import Shortcuts\n#color: red`, /Unknown metadata `#color`/],
    ["duplicate func", `import Shortcuts\nfunc a() {\n}\nfunc a() {\n}`, /declared twice/],
  ];
  for (const [name, code, pattern] of cases) {
    it(name, () => {
      expect(messages(errors(code))).toMatch(pattern);
      expect(validateJelly(code).ok).toBe(false);
    });
  }

  const warningCases: [string, string, RegExp][] = [
    ["missing import Shortcuts", `vibrate()`, /no `import Shortcuts`/],
    ["undefined variable", `import Shortcuts\nquicklook(input: mystery)`, /`mystery` is not defined/],
    ["func reading outer variable", `import Shortcuts\nvar limit = 3\nfunc f(x) {\n  showResult(text: "\${limit}")\n}`, /can't see outer variables/],
    ["loop variable outside loop", `import Shortcuts\nshowResult(text: "\${RepeatItem}")`, /only exists inside/],
    ["missing required parameter", `import Shortcuts\naskForInput(prompt: "Age?")`, /missing `type`/],
    ["unknown icon", `import Shortcuts\n#Icon: unicornz`, /not a known icon/],
    ["comparing to a variable", `import Shortcuts\nvar a = 1\nvar b = 2\nif a == b {\n}`, /Interpolate it/],
    ["old contains operator", `import Shortcuts\nvar a = "x"\nif a .contains "x" {\n}`, /old operator spelling/],
    ["semicolons", `import Shortcuts\nvibrate();`, /semicolons/],
    ["parentheses around an if condition", `import Shortcuts\nbatteryLevel() >> level\nif (level < 20) {\n  vibrate()\n}`, /Parentheses around an if condition/],
    ["menu prompt in parentheses", `import Shortcuts\nmenu("Pick") {\ncase "A":\n  vibrate()\n}`, /menu\("Prompt"\) \{` is rejected/],
  ];
  for (const [name, code, pattern] of warningCases) {
    it(`warns: ${name}`, () => {
      expect(messages(warnings(code))).toMatch(pattern);
    });
  }

  it("reports line and column numbers", () => {
    const [d] = errors(`import Shortcuts\n\n  showNotification(body: "x")`);
    expect(d.line).toBe(3);
    expect(d.col).toBe(3);
  });

  it("handles typed parameters whose names look like type hints", () => {
    const code = `import Shortcuts\nfunc stamp(date: date, list) {\n  return date\n}\nstamp(date: CurrentDate, list: "x") >> out`;
    expect(messages(errors(code))).toBe("");
  });

  it("does not crash on garbage input", () => {
    for (const junk of ["", "}}}{{{", '"""', "((((", "#", ">> x", "var", "if", "menu", "func", '"\\', "\u0000\u0001"]) {
      expect(() => validateJelly(junk)).not.toThrow();
    }
  });

  it("resolves a name shared by two libraries using the first import", () => {
    const code = `import Shortcuts\nimport DataJar\nsetValue(key: "a", value: "b", dictionary: ShortcutInput)`;
    expect(validateJelly(code).ok).toBe(true);
    expect(messages(errors(`import Shortcuts\nimport DataJar\nsetValue(keyPath: "a", values: ShortcutInput)`))).toMatch(/Move `import DataJar` above/);
  });
});
