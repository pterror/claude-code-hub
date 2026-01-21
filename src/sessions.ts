/**
 * Claude Code Session Reader
 *
 * Reads conversation history directly from Claude Code's session files.
 * Sessions are stored at ~/.claude/projects/<encoded-path>/<session-id>.jsonl
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AgentMessage } from "./agents";

/**
 * Encode a working directory path to Claude Code's format.
 * /home/me/git/foo -> -home-me-git-foo
 */
function encodePath(cwd: string): string {
  const expanded = cwd.replace(/^~/, homedir());
  return expanded.replace(/\//g, "-");
}

/**
 * Get the session file path for an agent.
 */
export function getSessionPath(cwd: string, sessionId: string): string {
  const claudeDir = join(homedir(), ".claude", "projects", encodePath(cwd));
  return join(claudeDir, `${sessionId}.jsonl`);
}

interface SessionEntry {
  type: "user" | "assistant" | "summary" | "queue-operation" | "file-history-snapshot";
  timestamp?: string;
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
    }>;
  };
}

/**
 * Load messages from a Claude Code session file.
 */
export function loadSessionMessages(cwd: string, sessionId: string): AgentMessage[] {
  const path = getSessionPath(cwd, sessionId);

  if (!existsSync(path)) {
    return [];
  }

  const messages: AgentMessage[] = [];

  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").filter(line => line.trim());

    for (const line of lines) {
      try {
        const entry: SessionEntry = JSON.parse(line);

        if (entry.type === "user" && entry.message?.content) {
          for (const block of entry.message.content) {
            if (block.type === "text" && block.text) {
              messages.push({
                type: "assistant", // We show user messages as context
                content: `[User]: ${block.text}`,
                timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
              });
            }
          }
        } else if (entry.type === "assistant" && entry.message?.content) {
          for (const block of entry.message.content) {
            if (block.type === "text" && block.text) {
              messages.push({
                type: "assistant",
                content: block.text,
                timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
              });
            } else if (block.type === "tool_use" && block.name) {
              messages.push({
                type: "tool",
                content: `Tool: ${block.name}`,
                timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
              });
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File read error - return empty
  }

  return messages;
}
