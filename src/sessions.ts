/**
 * Claude Code Session Reader
 *
 * Reads conversation history directly from Claude Code's session files.
 * Sessions are stored at ~/.claude/projects/<encoded-path>/<session-id>.jsonl
 */

import { readFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import type { AgentMessage } from "./agents";

export interface DiscoveredSession {
  sessionId: string;
  cwd: string;
  firstMessage: string;
  createdAt: Date;
  modifiedAt: Date;
}

/**
 * Encode a working directory path to Claude Code's format.
 * /home/me/git/foo -> -home-me-git-foo
 */
function encodePath(cwd: string): string {
  const expanded = cwd.replace(/^~/, homedir());
  return expanded.replace(/\//g, "-");
}

/**
 * Decode a Claude Code project folder name back to a path.
 * -home-me-git-foo -> /home/me/git/foo
 */
function decodePath(encoded: string): string {
  // Remove leading dash and replace dashes with slashes
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
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

/**
 * Extract first user message from session file (for preview).
 * Only reads first 4KB - user message is always near start.
 */
function getFirstUserMessage(filePath: string): string {
  try {
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(4096);
    const bytesRead = readSync(fd, buffer, 0, 4096, 0);
    closeSync(fd);

    const content = buffer.toString("utf-8", 0, bytesRead);

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "user" && entry.message?.content) {
          for (const block of entry.message.content) {
            if (block.type === "text" && block.text) {
              return block.text.slice(0, 200);
            }
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Ignore errors
  }
  return "";
}

/**
 * Discover all Claude Code sessions on disk.
 * Set readPrompts=true to read first message from each file (slower).
 */
export function discoverSessions(readPrompts = true): DiscoveredSession[] {
  const projectsDir = join(homedir(), ".claude", "projects");

  if (!existsSync(projectsDir)) {
    return [];
  }

  const sessions: DiscoveredSession[] = [];

  try {
    const projectDirs = readdirSync(projectsDir);

    for (const projectDir of projectDirs) {
      const projectPath = join(projectsDir, projectDir);
      const stat = statSync(projectPath);

      if (!stat.isDirectory()) continue;

      const cwd = decodePath(projectDir);

      // Find all .jsonl files in this project
      const files = readdirSync(projectPath).filter(f => f.endsWith(".jsonl"));

      for (const file of files) {
        const filePath = join(projectPath, file);
        const sessionId = basename(file, ".jsonl");

        // Skip non-UUID session files (like summaries)
        if (!/^[a-f0-9-]{36}$/.test(sessionId) && !sessionId.startsWith("agent-")) {
          continue;
        }

        try {
          const fileStat = statSync(filePath);
          sessions.push({
            sessionId,
            cwd,
            firstMessage: readPrompts ? getFirstUserMessage(filePath) : "",
            createdAt: fileStat.birthtime,
            modifiedAt: fileStat.mtime,
          });
        } catch {
          continue;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  // Sort by modification time, most recent first
  return sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}
