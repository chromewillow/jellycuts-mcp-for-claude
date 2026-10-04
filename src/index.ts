// Cloudflare Worker entry point.
//   /mcp         MCP endpoint (Streamable HTTP, stateless) — paste this URL into Claude
//   /s/<name>#…  install page for a shared script (the script lives in the #fragment)
//   /            setup page showing your connector URL

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./mcp";
import { homePage, installPage } from "./pages";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function handleMcp(request: Request, origin: string): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (request.method === "GET") {
    // A person opening the URL in a browser gets the setup page instead of protocol noise.
    if ((request.headers.get("Accept") ?? "").includes("text/html")) return html(homePage(origin));
    // Stateless server: no server-initiated stream to offer (allowed by the MCP spec).
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }), {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS", "Content-Type": "application/json" },
    });
  }
  if (request.method === "DELETE") {
    return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" } });
  }

  const server = createMcpServer({ origin });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: every request stands alone
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  return withHeaders(response, CORS_HEADERS);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/mcp" || path === "/sse") return handleMcp(request, origin);
    if (path === "/s" || path.startsWith("/s/")) return html(installPage());
    if (path === "/") return html(homePage(origin));
    if (path === "/health") {
      return Response.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION, mcp: `${origin}/mcp` }, { headers: CORS_HEADERS });
    }
    if (path === "/favicon.ico") return new Response(null, { status: 204 });
    return html(`<!doctype html><meta name="viewport" content="width=device-width"><p style="font-family:system-ui;padding:24px">Not found. <a href="/">Go to the setup page</a>.</p>`, 404);
  },
} satisfies ExportedHandler;
