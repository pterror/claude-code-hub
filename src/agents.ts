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

export interface Agent {
  id: string;
  cwd: string;
  prompt: string;
  status: "running" | "done" | "error" | "waiting";
  messages: AgentMessage[];
  createdAt: Date;
  sessionId?: string;
}

export interface AgentMessage {
  type: "assistant" | "tool" | "result" | "error";
  content: string;
  timestamp: Date;
}

type WebSocketClient = { send: (data: string) => void };

export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private subscribers: Set<WebSocketClient> = new Set();

  list(): Agent[] {
    return Array.from(this.agents.values());
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  async spawn(cwd: string, prompt: string): Promise<Agent> {
    const id = crypto.randomUUID();
    const agent: Agent = {
      id,
      cwd: cwd.replace("~", process.env.HOME || ""),
      prompt,
      status: "running",
      messages: [],
      createdAt: new Date(),
    };

    this.agents.set(id, agent);
    this.broadcast({ type: "spawn", agent });

    // Run agent in background
    this.runAgent(agent);

    return agent;
  }

  async message(id: string, prompt: string): Promise<{ ok: boolean }> {
    const agent = this.agents.get(id);
    if (!agent || !agent.sessionId) return { ok: false };

    // Resume session and send follow-up
    agent.status = "running";
    this.broadcast({ type: "status", agentId: agent.id, status: "running" });

    this.runFollowUp(agent, prompt);
    return { ok: true };
  }

  private async runAgent(agent: Agent) {
    try {
      const session = unstable_v2_createSession({
        cwd: agent.cwd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"],
        settingSources: ["project"], // Load CLAUDE.md from agent's working directory
      });

      await session.send(agent.prompt);

      for await (const msg of session.stream()) {
        // Capture session ID
        if (msg.session_id && !agent.sessionId) {
          agent.sessionId = msg.session_id;
        }

        this.handleMessage(agent, msg);
      }

      session.close();
      agent.status = "done";
      this.broadcast({ type: "done", agentId: agent.id });
    } catch (error) {
      agent.status = "error";
      agent.messages.push({
        type: "error",
        content: String(error),
        timestamp: new Date(),
      });
      this.broadcast({ type: "error", agentId: agent.id, error: String(error) });
    }
  }

  private async runFollowUp(agent: Agent, prompt: string) {
    try {
      const session = unstable_v2_resumeSession(agent.sessionId!, {
        cwd: agent.cwd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"],
        settingSources: ["project"],
      });

      await session.send(prompt);

      for await (const msg of session.stream()) {
        this.handleMessage(agent, msg);
      }

      session.close();
      agent.status = "done";
      this.broadcast({ type: "done", agentId: agent.id });
    } catch (error) {
      agent.status = "error";
      agent.messages.push({
        type: "error",
        content: String(error),
        timestamp: new Date(),
      });
      this.broadcast({ type: "error", agentId: agent.id, error: String(error) });
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
