/**
 * Claude Code Session Reader
 *
 * Uses ~/.claude/history.jsonl as index for fast session discovery.
 * Falls back to scanning session files if needed.
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

interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
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

// Cache for discovered sessions (5 second TTL)
let sessionCache: { data: DiscoveredSession[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 5000;

/**
 * Clear the session discovery cache.
 * Call this when you know sessions have changed (e.g., after spawning).
 */
export function invalidateSessionCache(): void {
  sessionCache = null;
}

/**
 * Discover all Claude Code sessions from history.jsonl index.
 * Much faster than scanning individual session files.
 * Results are cached for 5 seconds.
 */
export function discoverSessions(): DiscoveredSession[] {
  // Return cached result if valid
  if (sessionCache && Date.now() - sessionCache.timestamp < CACHE_TTL_MS) {
    return sessionCache.data;
  }

  const historyPath = join(homedir(), ".claude", "history.jsonl");

  if (!existsSync(historyPath)) {
    return discoverSessionsFromFiles();
  }

  try {
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.split("\n").filter(l => l.trim());

    // Group by sessionId, keep first message and timestamps
    const sessionMap = new Map<string, {
      firstMessage: string;
      cwd: string;
      firstTs: number;
      lastTs: number;
    }>();

    for (const line of lines) {
      try {
        const entry: HistoryEntry = JSON.parse(line);
        if (!entry.sessionId || !entry.project) continue;

        const existing = sessionMap.get(entry.sessionId);
        if (!existing) {
          sessionMap.set(entry.sessionId, {
            firstMessage: entry.display?.slice(0, 200) || "",
            cwd: entry.project,
            firstTs: entry.timestamp,
            lastTs: entry.timestamp,
          });
        } else {
          // Update last timestamp
          if (entry.timestamp > existing.lastTs) {
            existing.lastTs = entry.timestamp;
          }
          if (entry.timestamp < existing.firstTs) {
            existing.firstTs = entry.timestamp;
            existing.firstMessage = entry.display?.slice(0, 200) || "";
          }
        }
      } catch {
        continue;
      }
    }

    // Convert to array
    const sessions: DiscoveredSession[] = [];
    for (const [sessionId, data] of sessionMap) {
      sessions.push({
        sessionId,
        cwd: data.cwd,
        firstMessage: data.firstMessage,
        createdAt: new Date(data.firstTs),
        modifiedAt: new Date(data.lastTs),
      });
    }

    // Sort by last activity, most recent first
    const sorted = sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    sessionCache = { data: sorted, timestamp: Date.now() };
    return sorted;
  } catch {
    const fallback = discoverSessionsFromFiles();
    sessionCache = { data: fallback, timestamp: Date.now() };
    return fallback;
  }
}

/**
 * Fallback: discover sessions by scanning project directories.
 */
function discoverSessionsFromFiles(): DiscoveredSession[] {
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
      const files = readdirSync(projectPath).filter(f => f.endsWith(".jsonl"));

      for (const file of files) {
        const filePath = join(projectPath, file);
        const sessionId = basename(file, ".jsonl");

        if (!/^[a-f0-9-]{36}$/.test(sessionId) && !sessionId.startsWith("agent-")) {
          continue;
        }

        try {
          const fileStat = statSync(filePath);
          sessions.push({
            sessionId,
            cwd,
            firstMessage: getFirstUserMessage(filePath),
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

  return sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}
