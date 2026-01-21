/**
 * SQLite persistence for hub state
 *
 * Stores agent metadata so hub can reconnect after restart.
 * Note: Claude Code handles its own session persistence - we just track the mapping.
 */

import { Database } from "bun:sqlite";
import type { Agent } from "./agents";
import type { AgentCapabilities } from "./capabilities";

const DB_PATH = process.env.HUB_DB_PATH || "hub.db";

const db = new Database(DB_PATH, { create: true });

// Initialize schema
db.run(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    capabilities TEXT NOT NULL,
    session_id TEXT,
    created_at TEXT NOT NULL
  )
`);

export interface StoredAgent {
  id: string;
  cwd: string;
  prompt: string;
  status: string;
  capabilities: AgentCapabilities;
  sessionId?: string;
  createdAt: Date;
}

export function saveAgent(agent: Agent): void {
  db.run(
    `INSERT OR REPLACE INTO agents (id, cwd, prompt, status, capabilities, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      agent.id,
      agent.cwd,
      agent.prompt,
      agent.status,
      JSON.stringify(agent.capabilities),
      agent.sessionId || null,
      agent.createdAt.toISOString(),
    ]
  );
}

export function updateAgentStatus(id: string, status: string, sessionId?: string): void {
  if (sessionId !== undefined) {
    db.run(
      `UPDATE agents SET status = ?, session_id = ? WHERE id = ?`,
      [status, sessionId, id]
    );
  } else {
    db.run(`UPDATE agents SET status = ? WHERE id = ?`, [status, id]);
  }
}

export function updateAgentCapabilities(id: string, capabilities: AgentCapabilities): void {
  db.run(
    `UPDATE agents SET capabilities = ? WHERE id = ?`,
    [JSON.stringify(capabilities), id]
  );
}

export function loadAgents(): StoredAgent[] {
  const rows = db.query(`SELECT * FROM agents`).all() as Array<{
    id: string;
    cwd: string;
    prompt: string;
    status: string;
    capabilities: string;
    session_id: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    cwd: row.cwd,
    prompt: row.prompt,
    status: row.status,
    capabilities: JSON.parse(row.capabilities),
    sessionId: row.session_id || undefined,
    createdAt: new Date(row.created_at),
  }));
}

export function deleteAgent(id: string): void {
  db.run(`DELETE FROM agents WHERE id = ?`, [id]);
}

export function clearAllAgents(): void {
  db.run(`DELETE FROM agents`);
}
