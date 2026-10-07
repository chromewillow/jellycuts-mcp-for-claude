import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type Action,
  catalog,
  findActions,
  findActionsIgnoringCase,
  formatActionDetail,
  formatActionSummary,
  libraryNames,
  searchActions,
  suggestActions,
} from "./catalog";
import { GUIDE_SECTIONS, type GuideTopic, renderGuide } from "./guide";
import { formatValidation, validateJelly } from "./jelly/validate";
import { installLink } from "./share";

export const SERVER_NAME = "jellycuts";
export const SERVER_VERSION = "1.1.0";

export const INSTRUCTIONS = `This connector lets you build Apple Shortcuts for the user's iPhone with Jellycuts, an iOS app that compiles the Jelly scripting language into Shortcuts.

Workflow for any "make me a shortcut" request:
1. Call jelly_guide once per conversation before writing Jelly.
2. Use search_actions to find actions, then get_action for EVERY action you plan to use — never guess function names, parameter labels or enum values.
3. Write the script (import Shortcuts first, labelled arguments, outputs captured with >>). Write setting values exactly as get_action lists them, spaces included (property: File Extension, never FileExtension), and JSON parameters in the form get_action shows: dictionary(json: {"a": "b"}); downloadURL headers: {\\"a\\": \\"b\\"} as the last argument; never JSON inside quotes, never variables inside JSON.
4. Call validate_jelly and fix every error. Its rules come from what the Jellycuts app actually accepts, so don't share with allow_errors to get around one.
5. Call share_jelly and give the user the install link and the steps it returns.
If the user reports an error from the Jellycuts app, ask for the whole console text, fix the script, re-validate and share a new link.
Keep explanations short — the user is probably on their phone.`;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const failure = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

/** Docs examples sometimes use pre-Jelly 3 syntax; only show the ones that still validate. */
const exampleIsValid = new Map<string, boolean>();
function cleanExample(action: Action): boolean {
  const key = `${action.library}:${action.name}`;
  let ok = exampleIsValid.get(key);
  if (ok === undefined) {
    const imports = action.library === "Shortcuts" ? "import Shortcuts" : `import ${action.library}\nimport Shortcuts`;
    const body = action.example.split("\n").filter((l) => !l.startsWith("import ")).join("\n");
    ok = Boolean(action.example) && validateJelly(`${imports}\n${body}`).ok;
    exampleIsValid.set(key, ok);
  }
  return ok;
}

export function createMcpServer(options: { origin: string }): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "jelly_guide",
    {
      title: "Jelly language guide",
      description:
        "The Jelly language guide for Jellycuts (write iPhone Shortcuts as code). Read it once before writing any Jelly script: syntax rules, variables, if/repeat/menu, functions, recipes for common requests and how to get the shortcut onto the iPhone.",
      inputSchema: {
        topic: z
          .enum(["all", ...GUIDE_SECTIONS.map((s) => s.id)] as [string, ...string[]])
          .optional()
          .describe("Section to return. Default: all."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic }) => text(renderGuide((topic ?? "all") as GuideTopic, catalog.libraries)),
  );

  server.registerTool(
    "search_actions",
    {
      title: "Search Jelly actions",
      description:
        "Find Jelly actions (functions) by what they do — e.g. 'send notification', 'battery level', 'http request', 'speak text', 'get weather'. Returns function names, libraries and parameter labels (optional ones end in ?). Then call get_action for the exact syntax.",
      inputSchema: {
        query: z.string().describe("What the action should do, or part of its name. Empty with a library lists that library."),
        library: z.string().optional().describe(`Limit to one library: ${libraryNames.join(", ")}.`),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum results (default 10)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, library, limit }) => {
      if (library && !libraryNames.some((l) => l.toLowerCase() === library.toLowerCase())) {
        return failure(`Unknown library "${library}". Libraries: ${libraryNames.join(", ")}.`);
      }
      const results = searchActions(query, { library, limit: limit ?? 10 });
      if (!results.length) {
        return text(`No actions matched "${query}". Try other words (e.g. the Shortcuts action name), or call jelly_guide for common recipes.`);
      }
      const thirdParty = results.some((a) => a.library !== "Shortcuts");
      return text(
        [
          `${results.length} action${results.length === 1 ? "" : "s"} for "${query}"${library ? ` in ${library}` : ""}:`,
          ...results.map(formatActionSummary),
          thirdParty ? "\nActions marked [import X] need that library imported and its app installed; prefer built-in Shortcuts actions when possible." : "",
          "Call get_action with the names you'll use to get exact labels and allowed values.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "get_action",
    {
      title: "Get Jelly action details",
      description:
        "Exact syntax for one or more Jelly actions: every parameter label and type, which are optional, allowed enumeration values, the import needed and an example. Check every action before using it.",
      inputSchema: {
        names: z.array(z.string()).min(1).max(15).describe("Function names, e.g. [\"sendNotification\", \"askForInput\"]."),
        library: z.string().optional().describe("Only needed when a name exists in several libraries."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ names, library }) => {
      const parts: string[] = [];
      for (const raw of names) {
        const name = raw.trim().replace(/\(.*$/, "");
        let matches = findActions(name);
        if (!matches.length) matches = findActionsIgnoringCase(name);
        if (library) {
          const inLib = matches.filter((a) => a.library.toLowerCase() === library.toLowerCase());
          if (inLib.length) matches = inLib;
        }
        if (!matches.length) {
          const sugg = suggestActions(name);
          parts.push(`### ${name}\nNo action named \`${name}\`.${sugg.length ? ` Did you mean: ${sugg.map((s) => `\`${s}\``).join(", ")}?` : ""} Use search_actions.`);
          continue;
        }
        if (matches.length > 1) {
          parts.push(`\`${name}\` exists in ${matches.map((m) => m.library).join(" and ")} — the library imported first wins.`);
        }
        for (const action of matches) {
          const detail = formatActionDetail(cleanExample(action) ? action : { ...action, example: "" });
          parts.push(detail);
        }
      }
      return text(parts.join("\n\n"));
    },
  );

  server.registerTool(
    "validate_jelly",
    {
      title: "Check a Jelly script",
      description:
        "Statically check a Jelly script before the user builds it in Jellycuts: unknown actions, wrong or missing labels, invalid enum values, missing imports, unbalanced blocks, unsupported syntax. Fix every error, then call share_jelly.",
      inputSchema: {
        code: z.string().max(200_000).describe("The complete Jelly script."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ code }) => text(formatValidation(validateJelly(code))),
  );

  server.registerTool(
    "share_jelly",
    {
      title: "Create an install link",
      description:
        "Turn a finished, validated Jelly script into a link the user opens on their iPhone: it shows the code with a one-tap Copy button, an Open Jellycuts button and install steps. Refuses scripts with validation errors unless allow_errors is true.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("Shortcut name, e.g. \"Battery Saver\". The user should give the Jellycut this exact name."),
        code: z.string().min(1).max(60_000).describe("The complete Jelly script."),
        allow_errors: z
          .boolean()
          .optional()
          .describe("Share even if validate_jelly reports errors (only when you're sure the check is wrong)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name, code, allow_errors }) => {
      const result = validateJelly(code);
      if (!result.ok && !allow_errors) {
        return failure(`Not shared — the script has errors. Fix them and call share_jelly again.\n\n${formatValidation(result)}`);
      }
      const cleanName = name.trim().replace(/\s+/g, " ");
      const link = await installLink(options.origin, { name: cleanName, code });
      const usesFunc = result.stats.functions.length > 0 && /\bfunc\s/.test(code);
      const status = result.ok
        ? `validated: no errors${result.warnings ? `, ${result.warnings} warning${result.warnings === 1 ? "" : "s"}` : ""}`
        : `shared WITH ${result.errors} validation error${result.errors === 1 ? "" : "s"}`;
      return text(
        [
          `Install link for "${cleanName}" (${result.stats.lines} lines, ${status}):`,
          link,
          "",
          "Show the user the link (as a markdown link) and these steps:",
          "1. Tap the link, then tap **Copy code**.",
          `2. Tap **Open Jellycuts**, create a new Jellycut${usesFunc ? ` named exactly "${cleanName}"` : ""} and replace its text with the copied code.`,
          "3. Build/export it to Shortcuts, then tap **Add Shortcut**.",
          "If Jellycuts shows an error, ask the user to send you the message or a screenshot.",
          result.ok && result.warnings ? `\nWarnings (worth a look):\n${formatValidation(result).split("\n").slice(1, -1).join("\n")}` : "",
        ]
          .join("\n")
          .trim(),
      );
    },
  );

  return server;
}
