# TODO

## Current Status

**Phases 1-6 complete.** Fully functional multi-agent hub with:
- Real Claude Code agents via SDK (V2 API)
- Capability-based inter-agent communication
- SQLite persistence
- Glassmorphism UI with light/dark mode
- Mobile pull-to-refresh, presets, filter, keyboard shortcuts

## Phase 1: Basic Functionality (DONE)

- [x] Install and wire up `@anthropic-ai/claude-agent-sdk`
- [x] Implement actual agent spawning with V2 API (`unstable_v2_createSession`)
- [x] Pass `cwd` option to spawn agents in different repos
- [x] Stream agent messages to WebSocket subscribers
- [x] Handle agent completion and errors properly
- [x] Test with a single agent end-to-end
- [x] Session resumption for follow-ups (`unstable_v2_resumeSession`)

## Phase 2: Multi-Agent (DONE)

- [x] Spawn multiple agents simultaneously
- [x] Each agent gets its own CLAUDE.md from its working directory (via settingSources)
- [x] Track all agents independently
- [x] UI shows all agents, can expand/collapse each
- [x] Tested with multiple agents

## Phase 3: Agent Communication (DONE)

Capability-based communication model. Hub mediates all inter-agent communication.

### Per-agent capabilities (mutable at runtime)

```typescript
interface AgentCapabilities {
  canDiscover: boolean;      // Can see other agents exist
  canRead: string[];         // Agent IDs it can read status/output from ("*" = all)
  canMessage: string[];      // Agent IDs it can send messages to
  canSpawn: boolean;         // Can create new agents (coordinator pattern)
  canBeMessaged: string[];   // Who can message this agent ("*" = all)
}
```

### Capability presets

- `isolated`: all false/empty (default)
- `observer`: canDiscover + canRead:["*"]
- `peer`: canDiscover + canRead:["*"] + canMessage:["*"] + canBeMessaged:["*"]
- `coordinator`: all capabilities

### MCP tools exposed to agents (based on capabilities)

- `hub_list_agents(caller_id)` → returns agent IDs, status (requires canDiscover)
- `hub_read_agent(caller_id, target_id, detail)` → detail: "status" | "summary" | "full" (requires canRead)
- `hub_message_agent(caller_id, target_id, msg, timeout_ms)` → sync call, blocks until response
- `hub_spawn_agent(caller_id, cwd, prompt, preset)` → returns agent ID (requires canSpawn)

### API for human control

- `PATCH /agents/:id/capabilities` - modify mid-session
- `POST /agents` accepts `preset` field (isolated/observer/peer/coordinator)
- UI shows current preset, allows selection when spawning

### Implementation (DONE)

- [x] Define AgentCapabilities type (src/capabilities.ts)
- [x] Add capabilities field to Agent
- [x] Create hub MCP server with capability-gated tools (src/hub-mcp.ts)
- [x] Inject MCP server into agent sessions
- [x] Message routing with permission checks
- [x] PATCH endpoint for runtime capability changes
- [x] UI for capability selection

## Phase 4: Persistence (DONE)

- [x] SQLite for agent state (src/db.ts)
- [x] Persist agent metadata across hub restarts
- [x] Load agents from DB on startup
- [x] Session IDs preserved for Claude Code reconnection
- [ ] Persist agent todo lists (future - requires SDK support)
- [ ] Handle "waiting for input" state (future)

## Phase 5: Mobile Polish (DONE)

- [x] Dark/light mode based on system preference
- [x] Glassmorphism UI with CSS variables
- [x] Touch-friendly sizing (0.75rem padding on inputs)
- [x] Pull-to-refresh (touch gesture)
- [ ] Test UI on actual phone over tailscale
- [ ] Notifications when agent needs input or completes?

## Phase 6: Quality of Life (DONE)

- [x] Agent presets (saved to localStorage)
- [x] Quick-spawn buttons for frequent tasks
- [x] Search/filter agents
- [x] Token usage tracking (for quota plans)
- [x] Keyboard shortcuts: `/` prompt, `f` filter, `r` refresh, `1-9` toggle
- [ ] Recent agents history (future)
- [ ] Auto-spawn based on triggers (future)

## Non-Goals

- Swarm intelligence (agents coordinate explicitly, not emergently)
- Self-learning neural capabilities
- 54+ specialized agents
- Enterprise anything
- Replacing Claude Code - just orchestrating it
- Implicit/magic communication (all inter-agent comms go through explicit hub-mediated tools)

## Technical Decisions

### Why Bun?
- Fast, simple, built-in TypeScript
- Native HTTP server and WebSocket
- Single runtime, no build step needed

### Why not use claude-flow?
- Over-engineered for our needs
- Questionable provenance
- We need simple orchestration, not hive mind
- Want to understand every line of code

### Why HTTP + WebSocket?
- Works over tailscale trivially
- Any browser can connect
- Phone access without native app

## Known Risks (not blockers)

- SDK V2 API is `unstable_` prefixed - may change in future versions (V1 fallback exists)
- Inter-agent messaging not battle-tested yet
- UI message history not persisted (but Claude Code sessions are - resume works)

## Open Questions

- [ ] Best way to handle ANTHROPIC_API_KEY? Env var on server?
- [ ] Should we support multiple users or assume single-user?
- [ ] File watching to auto-detect repos in ~/git/?

## Future Ideas

- [x] PWA with service worker for offline UI caching
- [ ] Notifications (Web Push) when agent completes/needs input
- [ ] Recent agents history
- [ ] Auto-spawn based on triggers (webhooks, file changes)
- [ ] Message persistence (store conversation history)
- [ ] Agent templates with pre-configured CLAUDE.md
