/**
 * claude-code-hub server
 *
 * Simple orchestration hub for Claude Code agents.
 * Runs agents, tracks status, exposes API for UIs.
 */

import { AgentManager } from "./agents";
import { initPush, getPublicKey, addSubscription, removeSubscription } from "./push";
import { readdirSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Initialize push notifications
initPush();

function discoverRepos(baseDir: string = join(homedir(), "git")): string[] {
  if (!existsSync(baseDir)) return [];

  try {
    return readdirSync(baseDir)
      .filter(name => {
        const fullPath = join(baseDir, name);
        const gitPath = join(fullPath, ".git");
        return statSync(fullPath).isDirectory() && existsSync(gitPath);
      })
      .map(name => join(baseDir, name));
  } catch {
    return [];
  }
}

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
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Push notification endpoints
    if (path === "/push/vapid-public-key" && req.method === "GET") {
      return Response.json({ publicKey: getPublicKey() }, { headers: corsHeaders });
    }

    if (path === "/push/subscribe" && req.method === "POST") {
      const subscription = await req.json();
      addSubscription(subscription);
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    if (path === "/push/unsubscribe" && req.method === "POST") {
      const subscription = await req.json();
      removeSubscription(subscription);
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    // API routes
    if (path === "/repos" && req.method === "GET") {
      const repos = discoverRepos();
      return Response.json(repos, { headers: corsHeaders });
    }

    if (path === "/agents" && req.method === "GET") {
      const source = url.searchParams.get("source") as "hub" | "discovered" | "all" | null;
      return Response.json(agents.list({ source: source || "all" }), { headers: corsHeaders });
    }

    if (path === "/agents" && req.method === "POST") {
      const body = await req.json();
      const agent = await agents.spawn(body.cwd, body.prompt, body.preset || "isolated");
      return Response.json(agent, { headers: corsHeaders });
    }

    // Get single agent
    if (path.match(/^\/agents\/[^/]+$/) && req.method === "GET") {
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

    // Update agent capabilities
    if (path.startsWith("/agents/") && path.endsWith("/capabilities") && req.method === "PATCH") {
      const id = path.split("/")[2];
      const body = await req.json();
      const ok = agents.updateCapabilities(id, body);
      if (!ok) return new Response("Not found", { status: 404 });
      return Response.json({ ok: true, capabilities: agents.get(id)?.capabilities }, { headers: corsHeaders });
    }

    // Serve static UI
    if (path === "/" || path === "/index.html") {
      return new Response(Bun.file("ui/index.html"));
    }
    if (path === "/manifest.json") {
      return new Response(Bun.file("ui/manifest.json"), {
        headers: { "Content-Type": "application/manifest+json" },
      });
    }
    if (path === "/sw.js") {
      return new Response(Bun.file("ui/sw.js"), {
        headers: { "Content-Type": "application/javascript" },
      });
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
