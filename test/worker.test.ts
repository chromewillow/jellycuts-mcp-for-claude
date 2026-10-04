import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { decodeShare, encodeShare, slugify } from "../src/share";

const ORIGIN = "https://jellycuts-mcp.example.workers.dev";
const get = (path: string, headers: Record<string, string> = {}) => worker.fetch(new Request(ORIGIN + path, { headers }));

let id = 0;
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { result?: any; error?: any };
}

const callTool = async (name: string, args: Record<string, unknown>) => {
  const { result } = await rpc("tools/call", { name, arguments: args });
  return { text: result.content.map((c: { text: string }) => c.text).join("\n") as string, isError: Boolean(result.isError) };
};

describe("share links", () => {
  it("round-trips unicode code and names", async () => {
    const script = { name: "Café ☕️ Log", code: 'import Shortcuts\nalert(alert: "Héllo “world” 👋")\n' };
    expect(await decodeShare(await encodeShare(script))).toEqual(script);
  });

  it("makes readable slugs", () => {
    expect(slugify("Battery Saver!")).toBe("Battery-Saver");
    expect(slugify("☕️")).toBe("shortcut");
  });
});

describe("worker routes", () => {
  it("serves the setup page with the connector URL", async () => {
    const res = await get("/");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain(`${ORIGIN}/mcp`);
  });

  it("serves the install page", async () => {
    const res = await get("/s/Battery-Saver");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Copy code");
  });

  it("shows the setup page when /mcp is opened in a browser", async () => {
    const res = await get("/mcp", { Accept: "text/html" });
    expect(await res.text()).toContain("Add it to Claude");
  });

  it("answers GET /mcp from MCP clients with 405 (stateless server)", async () => {
    const res = await get("/mcp", { Accept: "text/event-stream" });
    expect(res.status).toBe(405);
  });

  it("handles CORS preflight", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/mcp`, { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("reports health", async () => {
    const res = await get("/health");
    expect(await res.json()).toMatchObject({ ok: true, mcp: `${ORIGIN}/mcp` });
  });
});

describe("MCP protocol", () => {
  it("initializes with instructions", async () => {
    const { result } = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(result.serverInfo.name).toBe("jellycuts");
    expect(result.instructions).toContain("share_jelly");
  });

  it("lists the five tools", async () => {
    const { result } = await rpc("tools/list");
    expect(result.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ["get_action", "jelly_guide", "search_actions", "share_jelly", "validate_jelly"].sort(),
    );
  });

  it("jelly_guide returns the guide", async () => {
    const { text } = await callTool("jelly_guide", {});
    expect(text).toContain("Golden rules");
    expect(text).toContain("import DataJar");
  });

  it("get_action explains parameters", async () => {
    const { text } = await callTool("get_action", { names: ["sendNotification", "notARealAction"] });
    expect(text).toContain("`body`");
    expect(text).toContain("No action named `notARealAction`");
  });

  it("share_jelly refuses scripts with errors", async () => {
    const { text, isError } = await callTool("share_jelly", { name: "Bad", code: "import Shortcuts\nshowNotification(body: 1)" });
    expect(isError).toBe(true);
    expect(text).toContain("Not shared");
  });

  it("share_jelly returns a link that decodes back to the script", async () => {
    const code = 'import Shortcuts\n#Color: blue, #Icon: star\nalert(alert: "Hi!", title: "Hello")';
    const { text, isError } = await callTool("share_jelly", { name: "Say Hi", code });
    expect(isError).toBe(false);
    const link = /https:\/\/\S+\/s\/Say-Hi#(\S+)/.exec(text);
    expect(link).not.toBeNull();
    expect(await decodeShare(link![1])).toEqual({ name: "Say Hi", code });
  });
});
