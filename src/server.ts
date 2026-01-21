/**
 * claude-code-hub server
 *
 * Simple orchestration hub for Claude Code agents.
 * Runs agents, tracks status, exposes API for UIs.
 */

import { AgentManager } from "./agents";

const PORT = Number(process.env.PORT) || 3000;
const agents = new AgentManager();

const server = Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket upgrade
    if (path === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // CORS for mobile access
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API routes
    if (path === "/agents" && req.method === "GET") {
      return Response.json(agents.list(), { headers: corsHeaders });
    }

    if (path === "/agents" && req.method === "POST") {
      const body = await req.json();
      const agent = await agents.spawn(body.cwd, body.prompt);
      return Response.json(agent, { headers: corsHeaders });
    }

    if (path.startsWith("/agents/") && req.method === "GET") {
      const id = path.split("/")[2];
      const agent = agents.get(id);
      if (!agent) return new Response("Not found", { status: 404 });
      return Response.json(agent, { headers: corsHeaders });
    }

    if (path.startsWith("/agents/") && path.endsWith("/message") && req.method === "POST") {
      const id = path.split("/")[2];
      const body = await req.json();
      const result = await agents.message(id, body.prompt);
      return Response.json(result, { headers: corsHeaders });
    }

    // Serve static UI
    if (path === "/" || path === "/index.html") {
      return new Response(Bun.file("ui/index.html"));
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) {
      agents.subscribe(ws);
    },
    close(ws) {
      agents.unsubscribe(ws);
    },
    message(ws, message) {
      // Handle incoming WebSocket messages if needed
    },
  },
});

console.log(`claude-code-hub running on http://localhost:${PORT}`);
console.log(`Access via tailscale at http://<your-tailscale-ip>:${PORT}`);
