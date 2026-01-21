/**
 * Agent management
 *
 * Spawns and tracks Claude Code agents via the Agent SDK.
 */

// TODO: Uncomment when agent SDK is installed
// import { query, ClaudeAgentOptions } from "@anthropic-ai/claude-agent-sdk";

export interface Agent {
  id: string;
  cwd: string;
  prompt: string;
  status: "running" | "done" | "error" | "waiting";
  messages: AgentMessage[];
  createdAt: Date;
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
    if (!agent) return { ok: false };

    // TODO: Send follow-up message to running agent
    // This requires session resumption via the SDK

    return { ok: true };
  }

  private async runAgent(agent: Agent) {
    try {
      // TODO: Use actual Agent SDK when installed
      // For now, simulate agent behavior
      /*
      for await (const message of query({
        prompt: agent.prompt,
        options: {
          workingDirectory: agent.cwd,
          allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"],
        },
      })) {
        this.handleMessage(agent, message);
      }
      */

      // Placeholder: simulate agent running
      await this.simulateAgent(agent);

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

  private async simulateAgent(agent: Agent) {
    // Placeholder simulation until SDK is wired up
    const steps = [
      "Reading project files...",
      "Analyzing codebase...",
      "Making changes...",
      "Done.",
    ];

    for (const step of steps) {
      await new Promise((r) => setTimeout(r, 1000));
      agent.messages.push({
        type: "assistant",
        content: step,
        timestamp: new Date(),
      });
      this.broadcast({ type: "message", agentId: agent.id, content: step });
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
