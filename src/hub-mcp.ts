/**
 * Hub MCP Server
 *
 * Exposes tools for inter-agent communication.
 * Each tool checks the calling agent's capabilities before executing.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentManager, Agent } from "./agents";
import { canRead, canMessage } from "./capabilities";

export function createHubMcpServer(manager: AgentManager) {
  return createSdkMcpServer({
    name: "hub",
    version: "1.0.0",
    tools: [
      tool(
        "hub_list_agents",
        "List all agents in the hub. Returns agent IDs and status. Requires canDiscover capability.",
        { caller_id: z.string().describe("Your agent ID") },
        async ({ caller_id }) => {
          const caller = manager.get(caller_id);
          if (!caller?.capabilities?.canDiscover) {
            return { content: [{ type: "text", text: "Permission denied: canDiscover is false" }], isError: true };
          }

          const agents = manager.list().map(a => ({
            id: a.id,
            cwd: a.cwd,
            status: a.status,
            prompt: a.prompt.slice(0, 100),
          }));

          return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
        }
      ),

      tool(
        "hub_read_agent",
        "Read detailed information about another agent. Detail levels: 'status' (basic), 'summary' (recent messages), 'full' (all messages).",
        {
          caller_id: z.string().describe("Your agent ID"),
          target_id: z.string().describe("Agent ID to read"),
          detail: z.enum(["status", "summary", "full"]).default("status").describe("Level of detail"),
        },
        async ({ caller_id, target_id, detail }) => {
          const caller = manager.get(caller_id);
          if (!caller?.capabilities || !canRead(caller.capabilities, target_id)) {
            return { content: [{ type: "text", text: "Permission denied: cannot read this agent" }], isError: true };
          }

          const target = manager.get(target_id);
          if (!target) {
            return { content: [{ type: "text", text: "Agent not found" }], isError: true };
          }

          let result: Record<string, unknown> = {
            id: target.id,
            cwd: target.cwd,
            status: target.status,
            prompt: target.prompt,
          };

          if (detail === "summary") {
            result.recentMessages = target.messages.slice(-5).map(m => m.content);
          } else if (detail === "full") {
            result.messages = target.messages;
          }

          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
      ),

      tool(
        "hub_message_agent",
        "Send a message to another agent and wait for response. The message is injected into the target agent's session.",
        {
          caller_id: z.string().describe("Your agent ID"),
          target_id: z.string().describe("Agent ID to message"),
          message: z.string().describe("Message to send"),
          timeout_ms: z.number().default(60000).describe("Timeout in milliseconds"),
        },
        async ({ caller_id, target_id, message, timeout_ms }) => {
          const caller = manager.get(caller_id);
          const target = manager.get(target_id);

          if (!caller?.capabilities || !target?.capabilities) {
            return { content: [{ type: "text", text: "Agent not found" }], isError: true };
          }

          if (!canMessage(caller.capabilities, caller_id, target.capabilities, target_id)) {
            return { content: [{ type: "text", text: "Permission denied: cannot message this agent" }], isError: true };
          }

          // Send message to target agent
          const result = await manager.messageFromAgent(caller_id, target_id, message, timeout_ms);

          if (!result.ok) {
            return { content: [{ type: "text", text: result.error || "Failed to send message" }], isError: true };
          }

          return { content: [{ type: "text", text: result.response || "Message sent (no response)" }] };
        }
      ),

      tool(
        "hub_spawn_agent",
        "Spawn a new agent. Requires canSpawn capability.",
        {
          caller_id: z.string().describe("Your agent ID"),
          cwd: z.string().describe("Working directory for new agent"),
          prompt: z.string().describe("Initial prompt for the agent"),
          preset: z.enum(["isolated", "observer", "peer", "coordinator"]).default("isolated").describe("Capability preset"),
        },
        async ({ caller_id, cwd, prompt, preset }) => {
          const caller = manager.get(caller_id);
          if (!caller?.capabilities?.canSpawn) {
            return { content: [{ type: "text", text: "Permission denied: canSpawn is false" }], isError: true };
          }

          const agent = await manager.spawn(cwd, prompt, preset);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({ id: agent.id, cwd: agent.cwd, status: agent.status }, null, 2)
            }]
          };
        }
      ),
    ],
  });
}
