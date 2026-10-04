// The Jelly language guide that the `jelly_guide` tool returns to Claude.
//
// Sources: docs.jellycuts.com (Jelly 3 notes + the March 2026 language update) and the
// open-source compiler (OpenJelly/Open-Jellycore). Every example in the "safe" sections
// compiles with the open-source compiler; features only documented for newer Jellycuts
// releases are labelled as such.

export interface GuideSection {
  id: string;
  title: string;
  body: string;
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "rules",
    title: "Golden rules",
    body: `Jelly is the text language of the Jellycuts iOS app. Jellycuts compiles a Jelly script into an Apple Shortcut; every function call becomes one Shortcuts action.

1. Start every script with \`import Shortcuts\` (plus any third-party library you use), then a metadata line such as \`#Color: blue, #Icon: star\`.
2. Only call functions that exist. Look every action up with \`search_actions\` / \`get_action\` — never guess a function name or a parameter label.
3. Label every argument: \`alert(alert: "Hi", title: "Hello")\`. Unlabelled arguments (\`quicklook(x)\`) are Jelly 2 syntax and fail to build.
4. Capture an action's output with \`>> name\` and use \`name\` later. Names may only contain letters, digits and \`_\` — no spaces.
5. Built-in variables are written without spaces: \`ShortcutInput\`, \`Clipboard\`, \`CurrentDate\`, \`Ask\`, and inside loops \`RepeatItem\` / \`RepeatIndex\`.
6. Text goes in double quotes. Insert variables with \`\${name}\`. Escape a quote inside text as \`\\"\`.
7. Enumeration parameters take a bare word exactly as \`get_action\` lists it: \`type: Number\`, \`type: ItemAtIndex\` — not \`"Number"\`, not \`Item at Index\`. Time spans are quoted: \`duration: "10 min"\`.
8. Define a \`func\` or \`macro\` above the place you call it.
9. There is no \`else if\`, \`while\`, \`for\`, \`let\`, \`const\`, \`switch\` or semicolons. Use nested \`if\`, \`repeat\`, \`repeatEach\`, \`var\` and \`menu\`.
10. Validate with \`validate_jelly\` before handing the script to the user, then call \`share_jelly\`.`,
  },
  {
    id: "structure",
    title: "Script structure",
    body: `\`\`\`jelly
import Shortcuts
#Color: blue, #Icon: star

// Ask for a name and greet the user
askForInput(prompt: "What's your name?", type: Text) >> name
alert(alert: "Hello, \${name}!", title: "Hi there")
\`\`\`

- \`import Shortcuts\` gives you Apple's built-in actions. Other libraries (\`import DataJar\`, \`import Toolbox\`, …) add actions from third-party apps the user must have installed. Imports only apply to lines below them, so keep them at the top.
- Metadata: \`#Color: <color>, #Icon: <icon>\` on one line sets the shortcut's tile in the Shortcuts app.
  - Colors: red, orange, tangerine, yellow, green, teal, blue, navy, grape, purple, pink (also lightBlue, grayBlue, grayGreen, grayBrown).
  - Reliable icons: star, heart, house, sun, moon, cloud, umbrella, globe, map, camera, picture, microphone, calendar, clock, timer, stopwatch, bell, battery, gear, wrench, list, clipboard, folder, envelope, phone, lock, key, flag, lightbulb, trophy, gift, rocket, car, bike, airplane, mug, apple, pill, heart, dog, cat, shortcuts. (The full list has ~340 names.)
- Comments: \`// one line\` or \`/* block */\`.
- One statement per line. Blank lines are fine.`,
  },
  {
    id: "variables",
    title: "Variables, strings and outputs",
    body: `**Outputs (magic variables).** Put \`>> name\` after any call to keep its result. They are read-only.
\`\`\`jelly
batteryLevel() >> level
text(text: "Battery: \${level}%") >> message
\`\`\`

**Variables** (\`var\`) are mutable and become Shortcuts "Set Variable" actions.
\`\`\`jelly
var greeting = "Hello"          // text
var limit = 20                  // number
var copy = level                // copy an output so you can change it later
greeting = "Hi"                 // reassign (no var)
var note = """
Line one
Line two
"""                             // multi-line text
\`\`\`
\`x += item\` appends to a variable (turning it into a list).

**Strings.** Interpolate with \`\${name}\`; it also works with built-ins and modifiers, e.g. \`"\${ShortcutInput.as(Dictionary).key(name)}"\`. Escape quotes as \`\\"\`.

**Built-in variables:** \`ShortcutInput\` (whatever was passed to the shortcut), \`Clipboard\`, \`CurrentDate\`, \`Ask\` (asks the user each time it's used), and inside loops \`RepeatItem\` and \`RepeatIndex\`.

**Modifiers** (equivalent to tapping a variable in Shortcuts):
- \`.as(Type)\` — treat as a type: \`ShortcutInput.as(Text)\`. Types: AppStore, Article, Boolean, Contact, Date, Dictionary, Email, File, Image, iMedia, iProduct, Location, MapLink, Media, Number, PDF, PhoneNumber, Photo, Place, RichText, Webpage, Text, URL, VCard.
- \`.key(name)\` — value for a key of a dictionary: \`response.as(Dictionary).key(title)\`.
- \`.get(Property)\` — a property such as a file's name.

**Lists and dictionaries**
\`\`\`jelly
list(items: ["Milk", "Eggs", "Bread"]) >> groceries
dictionary(json: "{\\"name\\": \\"Ada\\", \\"age\\": 36}") >> person   // JSON inside a string, quotes escaped
valueFor(key: "name", dictionary: person) >> name
getItemFromList(list: groceries, type: ItemAtIndex, index: "2") >> second
\`\`\`

**Maths:** \`calculate(input: "\${a} * 2 + \${b}") >> result\`, or \`math(...)\`, \`round(...)\`, \`randomNumber(min: 1, max: 6)\`.

**Newer syntax (Jellycuts March 2026 and later).** Expression assignments: \`var items = ["a", "b"]\`, \`var total = price * 2\`, \`var first = items[0]\`, \`var out = myFunc(value: x)\`, and \`return a + b\` in functions. Prefer the classic forms above when you are not sure the user's app is up to date.`,
  },
  {
    id: "control_flow",
    title: "If / else, loops and menus",
    body: `**If / else**
\`\`\`jelly
batteryLevel() >> level
if level < 20 {
    lowPowerMode(state: true)
    sendNotification(body: "Battery is at \${level}%. Low Power Mode is on.", title: "Battery")
} else {
    showResult(text: "Battery is fine: \${level}%")
}
\`\`\`
- Left side: a variable or output. Right side: a number, a "string", or \`nil\`.
- Don't wrap the condition in parentheses: \`if (level < 20) {\` is rejected by some Jellycuts versions; \`if level < 20 {\` is the safe form.
- Operators: \`==\` is, \`!=\` is not, \`<\` \`<=\` \`>\` \`>=\` numbers, \`::\` contains, \`!:\` does not contain, \`$$\` begins with, \`$!\` ends with, \`== nil\` has no value, \`!= nil\` has any value.
- One comparison per \`if\`. Do NOT use \`&&\` or \`||\` — nest \`if\`s instead (or check with \`::\` on combined text).
- To compare with another variable, interpolate it: \`if answer == "\${expected}" {\`. For numeric comparisons between two variables, compute the difference first: \`calculate(input: "\${a} - \${b}") >> diff\` then \`if diff > 0 {\`.
- No \`else if\`: put another \`if\` inside \`else { }\`.
- Always compare explicitly; don't write a bare \`if flag {\`.

**Repeat N times**
\`\`\`jelly
repeat(3) {
    vibrate()
    wait(seconds: 1)
}
\`\`\`
\`RepeatIndex\` is the 1-based counter. Prefer a number literal; newer Jellycuts also accepts a variable (\`repeat(count) {\`).

**Repeat with each item**
\`\`\`jelly
list(items: ["Milk", "Eggs", "Bread"]) >> groceries
repeatEach(groceries) {
    sendNotification(body: "Buy \${RepeatItem}", title: "Item \${RepeatIndex}")
}
\`\`\`
In nested loops the inner loop's built-ins are \`RepeatItem2\` / \`RepeatIndex2\` (like Shortcuts' "Repeat Item 2"); copying the outer item first (\`var outer = RepeatItem\`) keeps things clear.
To collect results from a loop, append to a variable that was created before the loop: \`results += RepeatItem\`.

**Menus**
\`\`\`jelly
menu "What are you drinking?" {
case "Coffee":
    var drink = "Coffee"
case "Water":
    var drink = "Water"
}
showResult(text: "Logged \${drink}")
\`\`\`
- Write the prompt without parentheses (\`menu "Prompt" {\`): the documented \`menu("Prompt") {\` form is rejected by some Jellycuts versions.
- Case labels are plain strings (no variables).
- Always-works alternative, also good for dynamic options:
\`\`\`jelly
list(items: ["Coffee", "Water"]) >> options
choose(list: options, prompt: "What are you drinking?") >> drink
if drink == "Coffee" {
    vibrate()
}
\`\`\`

**Stopping and output:** \`exit()\` stops the shortcut. \`showResult(text: ...)\`, \`quicklook(input: ...)\`, \`alert(alert: ..., title: ...)\` and \`sendNotification(body: ..., title: ...)\` show things to the user. \`output(notes: "\${value}")\` returns a value to whoever ran the shortcut.`,
  },
  {
    id: "functions",
    title: "Functions and macros",
    body: `\`\`\`jelly
func greet(name) {
    text(text: "Hello, \${name}!") >> greeting
    return greeting
}

greet(name: "Ada") >> message
showResult(text: message)
\`\`\`
- Declare before use. Call with labels matching the parameter names; capture the return value with \`>>\`.
- A \`func\` becomes a call back into the same shortcut (Shortcuts "Run Shortcut" with a dictionary), so it cannot see variables created outside it — pass them in as parameters. It only works once the shortcut is saved under its final name.
- A \`macro\` (same syntax, keyword \`macro\`) pastes its body where it's called: faster, and it can read and change outer variables. Prefer macros for small helpers.
- Newer Jellycuts accepts typed parameters (\`func add(a: int, b: int)\`; types str, int, bool, list, dict, date, any) and expressions after \`return\`.`,
  },
  {
    id: "recipes",
    title: "Recipes for common requests",
    body: `- **Notification:** \`sendNotification(body: "...", title: "...")\`
- **Speak text:** \`speakText(text: "...")\`
- **Ask the user:** \`askForInput(prompt: "...", type: Text) >> answer\` (types: Text, URL, Number, Date, Time, DateandTime); pick from a list: \`choose(list: items, prompt: "...") >> picked\`
- **Web request / API:** \`urlContents(url: "https://...") >> response\` (simple GET) or \`downloadURL(url: ..., method: POST, headers: "{\\"Accept\\": \\"application/json\\"}", requestType: Json, requestJSON: "{\\"key\\": \\"value\\"}") >> response\`; then \`getDictionaryFrom(input: response) >> data\` and \`valueFor(key: "field", dictionary: data) >> value\`.
- **Clipboard:** \`getClipboard() >> clip\`, \`setClipboard(variable: value)\`
- **Dates:** \`formatDate(date: "\${CurrentDate}", dStyle: Long, tStyle: Short) >> today\`, \`adjustDate(operation: Add, duration: "10 min", date: "\${CurrentDate}") >> later\`, \`timer(duration: "15 min")\`
- **Device:** \`batteryLevel()\`, \`deviceDetails(detail: DeviceName)\`, \`setBrightness(value: 0.5)\`, \`setVolume(level: 0.5)\`, \`setDND(state: true)\`, \`setWiFi(state: false)\`, \`setBluetooth(value: false)\`, \`lowPowerMode(state: true)\`
- **Open things:** \`openURL(url: "https://...")\`, \`runShortcut(name: "Other Shortcut")\`
- **Text:** \`replaceText(...)\`, \`splitText(...)\`, \`combineText(...)\`, \`changeCase(text: ..., case: uppercase)\`, \`matchText(...)\`, \`count(type: Items, input: list)\`
- **Weather / location:** \`getCurrentConditions() >> weather\`, \`conditionDetail(detail: Temperature, condition: weather)\`, \`getLocation(...)\`
These are starting points — confirm parameters with \`get_action\` before using them.`,
  },
  {
    id: "delivery",
    title: "Getting the shortcut onto the iPhone",
    body: `1. Call \`validate_jelly\` and fix every error (warnings are worth a look too).
2. Call \`share_jelly\` with a short name. It returns an install link.
3. Give the user the link and these steps: tap the link → **Copy code** → **Open Jellycuts** → create a new Jellycut and replace its contents with the copied code → build/export it to Shortcuts → tap **Add Shortcut**.
4. If Jellycuts shows an error, ask the user to paste or screenshot the console message. Fix it (use \`get_action\` to re-check labels), re-validate, and share a new link.

Shortcuts that use a \`func\` run themselves by name, so tell the user to keep the shortcut's name the same as the Jellycut's name.`,
  },
  {
    id: "troubleshooting",
    title: "When Jellycuts reports an error",
    body: `- "function … has not been defined in the scope": wrong function name or a missing \`import\`. Use \`search_actions\`.
- "Missing parameter name": an argument has no label. Write \`name: value\`.
- "Missing parameter X": only a warning — Jellycuts uses a default. Add it if the default isn't what you want.
- "Variable X does not exist": the variable is used before it's created, has a typo, or was created outside a \`func\`.
- "SYNTAX ERROR, line N": look for an unclosed \`{\`, \`(\`, \`[\` or \`"\`, a stray \`else if\`, spaces in a name, JSON that isn't inside an escaped string, or parentheses around an \`if\` condition or \`menu\` prompt. A menu that still fails can be rewritten with \`choose(list:, prompt:)\` + \`if\`.
- "Invalid Flag Value": \`#Color\` / \`#Icon\` value isn't recognised; switch to one from the lists in this guide.
- Deprecation warnings about spaces in variable names: rename \`Shortcut Input\` → \`ShortcutInput\`, \`Repeat Item\` → \`RepeatItem\`, etc.
- Errors only inside a \`func\` / \`macro\` body (an action "not defined in the scope", a parameter that "does not exist"): older Jellycuts versions handle functions poorly — inline the code instead.
- Something newer (\`+=\`, \`repeat(variable)\`, expression assignments) fails: the user's Jellycuts is older — rewrite it the classic way (\`calculate\`, a literal count, a \`>>\` output).`,
  },
];

export const GUIDE_TOPICS = ["all", ...GUIDE_SECTIONS.map((s) => s.id)] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export function renderGuide(topic: GuideTopic = "all", libraries: { import: string; title: string; actions: number }[] = []): string {
  const sections = topic === "all" ? GUIDE_SECTIONS : GUIDE_SECTIONS.filter((s) => s.id === topic);
  const parts = sections.map((s) => `## ${s.title}\n\n${s.body}`);
  if ((topic === "all" || topic === "structure") && libraries.length) {
    const rows = libraries.map((l) => `- \`import ${l.import}\` — ${l.title} (${l.actions} actions)`).join("\n");
    parts.push(`## Libraries\n\n${rows}\n\nThird-party libraries only work if the user has that app installed.`);
  }
  return `# Jelly language guide (Jellycuts)\n\n${parts.join("\n\n")}`;
}
