/**
 * Agent management
 *
 * Spawns and tracks Claude Code agents via the Agent SDK.
 */

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type AgentCapabilities,
  type CapabilityPreset,
  getDefaultCapabilities,
  applyPreset,
} from "./capabilities";
import { createAgentMcpServer } from "./hub-mcp";
import { loadSessionMessages, discoverSessions } from "./sessions";
import { sendNotification } from "./push";
import * as db from "./db";

export interface Agent {
  id: string;
  cwd: string;
  prompt: string;
  status: "running" | "done" | "error" | "waiting";
  messages: AgentMessage[];
  createdAt: Date;
  sessionId?: string;
  capabilities: AgentCapabilities;
  tokens?: number;
  costUsd?: number;
  source: "hub" | "discovered";
}

export interface AgentMessage {
  type: "assistant" | "tool" | "result" | "error";
  content: string;
  timestamp: Date;
}

type WebSocketClient = { send: (data: string) => void };

interface PendingMessage {
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private subscribers: Set<WebSocketClient> = new Set();
  private pendingMessages: Map<string, PendingMessage> = new Map();

  constructor() {
    this.loadFromDb();
  }

  private loadFromDb() {
    const stored = db.loadAgents();
    for (const agent of stored) {
      // Load messages from Claude Code's session files
      const messages = agent.sessionId
        ? loadSessionMessages(agent.cwd, agent.sessionId)
        : [];

      this.agents.set(agent.id, {
        id: agent.id,
        cwd: agent.cwd,
        prompt: agent.prompt,
        status: agent.status as Agent["status"],
        messages,
        createdAt: agent.createdAt,
        sessionId: agent.sessionId,
        capabilities: agent.capabilities,
        source: "hub",
      });
    }
    console.log(`Loaded ${stored.length} agents from database`);
  }

  list(filter?: { source?: "hub" | "discovered" | "all" }): Agent[] {
    const source = filter?.source || "all";
    const hubAgents = Array.from(this.agents.values());

    if (source === "hub") {
      return hubAgents;
    }

    // Discover sessions from disk and merge
    const discovered = discoverSessions();
    const knownSessionIds = new Set(hubAgents.map(a => a.sessionId).filter(Boolean));

    const discoveredAgents: Agent[] = discovered
      .filter(s => !knownSessionIds.has(s.sessionId))
      .map(s => ({
        id: s.sessionId, // Use session ID as agent ID for discovered
        cwd: s.cwd,
        prompt: s.firstMessage || "(no prompt)",
        status: "done" as const,
        messages: [], // Lazy load on demand
        createdAt: s.createdAt,
        sessionId: s.sessionId,
        capabilities: getDefaultCapabilities(),
        source: "discovered" as const,
      }));

    if (source === "discovered") {
      return discoveredAgents;
    }

    // Merge and sort by creation date
    return [...hubAgents, ...discoveredAgents].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  async spawn(
    cwd: string,
    prompt: string,
    preset: CapabilityPreset = "isolated"
  ): Promise<Agent> {
    const id = crypto.randomUUID();
    const agent: Agent = {
      id,
      cwd: cwd.replace("~", process.env.HOME || ""),
      prompt,
      status: "running",
      messages: [],
      createdAt: new Date(),
      capabilities: applyPreset(preset),
      source: "hub",
    };

    this.agents.set(id, agent);
    db.saveAgent(agent);
    this.broadcast({ type: "spawn", agent });

    // Run agent in background
    this.runAgent(agent);

    return agent;
  }

  /**
   * Update an agent's capabilities at runtime
   */
  updateCapabilities(id: string, capabilities: Partial<AgentCapabilities>): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;

    agent.capabilities = { ...agent.capabilities, ...capabilities };
    db.updateAgentCapabilities(id, agent.capabilities);
    this.broadcast({ type: "capabilities", agentId: id, capabilities: agent.capabilities });
    return true;
  }

  /**
   * Send a follow-up message from a human
   */
  async message(id: string, prompt: string): Promise<{ ok: boolean }> {
    const agent = this.agents.get(id);
    if (!agent || !agent.sessionId) return { ok: false };

    agent.status = "running";
    db.updateAgentStatus(id, "running");
    this.broadcast({ type: "status", agentId: agent.id, status: "running" });

    this.runFollowUp(agent, prompt);
    return { ok: true };
  }

  /**
   * Send a message from one agent to another (via MCP tool)
   */
  async messageFromAgent(
    senderId: string,
    targetId: string,
    message: string,
    timeoutMs: number = 60000
  ): Promise<{ ok: boolean; response?: string; error?: string }> {
    const target = this.agents.get(targetId);
    if (!target || !target.sessionId) {
      return { ok: false, error: "Target agent not found or has no session" };
    }

    if (target.status !== "done" && target.status !== "waiting") {
      return { ok: false, error: "Target agent is busy" };
    }

    // Create a promise that resolves when target responds
    const messageId = crypto.randomUUID();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(messageId);
        resolve({ ok: false, error: "Timeout waiting for response" });
      }, timeoutMs);

      this.pendingMessages.set(messageId, {
        resolve: (response: string) => {
          clearTimeout(timeout);
          this.pendingMessages.delete(messageId);
          resolve({ ok: true, response });
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          this.pendingMessages.delete(messageId);
          resolve({ ok: false, error: error.message });
        },
        timeout,
      });

      // Send the message to target, prefixed with context
      const prefixedMessage = `[Message from agent ${senderId}]: ${message}`;
      this.runFollowUp(target, prefixedMessage, messageId);
    });
  }

  private async runAgent(agent: Agent) {
    try {
      // Create per-agent MCP server with ID baked in (no trust issues)
      const agentMcpServer = createAgentMcpServer(agent.id, this);

      const session = unstable_v2_createSession({
        cwd: agent.cwd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"],
        settingSources: ["project"],
        mcpServers: {
          hub: agentMcpServer,
        },
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: `\n\nYou are agent ${agent.id} in a multi-agent hub. You have access to hub_* tools for inter-agent communication (if your capabilities allow). Your current capabilities: ${JSON.stringify(agent.capabilities)}`,
        },
      });

      await session.send(agent.prompt);

      for await (const msg of session.stream()) {
        if (msg.session_id && !agent.sessionId) {
          agent.sessionId = msg.session_id;
          db.updateAgentStatus(agent.id, agent.status, agent.sessionId);
        }
        this.handleMessage(agent, msg);
      }

      session.close();
      agent.status = "done";
      db.updateAgentStatus(agent.id, "done");
      this.broadcast({ type: "done", agentId: agent.id });
      sendNotification("Agent completed", `${agent.cwd.split("/").pop()}: ${agent.prompt.slice(0, 50)}`, agent.id);
    } catch (error) {
      agent.status = "error";
      db.updateAgentStatus(agent.id, "error");
      agent.messages.push({
        type: "error",
        content: String(error),
        timestamp: new Date(),
      });
      this.broadcast({ type: "error", agentId: agent.id, error: String(error) });
      sendNotification("Agent error", `${agent.cwd.split("/").pop()}: ${String(error).slice(0, 50)}`, agent.id);
    }
  }

  private async runFollowUp(agent: Agent, prompt: string, messageId?: string) {
    try {
      // Create per-agent MCP server with ID baked in
      const agentMcpServer = createAgentMcpServer(agent.id, this);

      const session = unstable_v2_resumeSession(agent.sessionId!, {
        cwd: agent.cwd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"],
        settingSources: ["project"],
        mcpServers: {
          hub: agentMcpServer,
        },
      });

      await session.send(prompt);

      let lastAssistantMessage = "";
      for await (const msg of session.stream()) {
        this.handleMessage(agent, msg);

        // Capture last assistant text for response
        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if ("text" in block && block.text) {
              lastAssistantMessage = block.text;
            }
          }
        }
      }

      session.close();
      agent.status = "done";
      db.updateAgentStatus(agent.id, "done");
      this.broadcast({ type: "done", agentId: agent.id });

      // If this was an inter-agent message, resolve the pending promise
      if (messageId && this.pendingMessages.has(messageId)) {
        this.pendingMessages.get(messageId)!.resolve(lastAssistantMessage);
      } else {
        // Only notify for human-initiated follow-ups
        sendNotification("Agent completed", `${agent.cwd.split("/").pop()}: done`, agent.id);
      }
    } catch (error) {
      agent.status = "error";
      db.updateAgentStatus(agent.id, "error");
      agent.messages.push({
        type: "error",
        content: String(error),
        timestamp: new Date(),
      });
      this.broadcast({ type: "error", agentId: agent.id, error: String(error) });

      if (messageId && this.pendingMessages.has(messageId)) {
        this.pendingMessages.get(messageId)!.reject(error as Error);
      } else {
        sendNotification("Agent error", `${agent.cwd.split("/").pop()}: ${String(error).slice(0, 50)}`, agent.id);
      }
    }
  }

  private handleMessage(agent: Agent, msg: SDKMessage) {
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if ("text" in block && block.text) {
          agent.messages.push({
            type: "assistant",
            content: block.text,
            timestamp: new Date(),
          });
          this.broadcast({
            type: "message",
            agentId: agent.id,
            messageType: "assistant",
            content: block.text,
          });
        } else if ("name" in block) {
          agent.messages.push({
            type: "tool",
            content: `Tool: ${block.name}`,
            timestamp: new Date(),
          });
          this.broadcast({
            type: "message",
            agentId: agent.id,
            messageType: "tool",
            content: `Tool: ${block.name}`,
          });
        }
      }
    } else if (msg.type === "result") {
      const content = msg.subtype === "success" ? msg.result : `Error: ${msg.subtype}`;

      // Capture token usage
      if (msg.usage) {
        const totalTokens = (msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0);
        agent.tokens = (agent.tokens || 0) + totalTokens;
      }
      if ("total_cost_usd" in msg && typeof msg.total_cost_usd === "number") {
        agent.costUsd = (agent.costUsd || 0) + msg.total_cost_usd;
      }

      agent.messages.push({
        type: "result",
        content,
        timestamp: new Date(),
      });
      this.broadcast({
        type: "message",
        agentId: agent.id,
        messageType: "result",
        content,
        tokens: agent.tokens,
        costUsd: agent.costUsd,
      });
    }
  }

  subscribe(ws: WebSocketClient) {
    this.subscribers.add(ws);
  }

  unsubscribe(ws: WebSocketClient) {
    this.subscribers.delete(ws);
  }

  private broadcast(data: unknown) {
    const json = JSON.stringify(data);
    for (const ws of this.subscribers) {
      ws.send(json);
    }
  }
}
