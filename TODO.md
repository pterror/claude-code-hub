# TODO

## Current Status

Phase 1 complete. Server spawns real Claude Code agents via the SDK.

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

## Phase 3: Agent Communication

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

- `list_agents()` → returns agent IDs, status (requires canDiscover)
- `read_agent(id, detail)` → detail: "status" | "summary" | "full" (requires id in canRead)
- `message_agent(id, msg, timeout_ms?)` → sync call, blocks until response (requires canMessage + target allows)
- `spawn_agent(cwd, prompt, capabilities?)` → returns agent ID (requires canSpawn)

### API for human control

- `PATCH /agents/:id/capabilities` - modify mid-session
- `POST /agents` accepts `capabilities` field
- UI shows current capabilities, allows toggling

### Implementation

- [ ] Define AgentCapabilities type
- [ ] Add capabilities field to Agent
- [ ] Create hub MCP server with capability-gated tools
- [ ] Inject MCP server into agent sessions
- [ ] Message routing with permission checks
- [ ] PATCH endpoint for runtime capability changes
- [ ] UI for capability management

## Phase 4: Persistence

- [ ] SQLite for agent state
- [ ] Persist sessions across server restarts
- [ ] Persist agent todo lists (Claude Code loses them on --continue)
- [ ] Resume agents after hub restart
- [ ] Handle "waiting for input" state

## Phase 5: Mobile Polish

- [ ] Test UI on actual phone over tailscale
- [ ] Touch-friendly interactions
- [ ] Pull-to-refresh
- [ ] Notifications when agent needs input or completes?
- [ ] Dark/light mode based on system preference

## Phase 6: Quality of Life

- [ ] Agent presets (common repos + prompts + capabilities)
- [ ] Quick-spawn buttons for frequent tasks
- [ ] Recent agents history
- [ ] Search/filter agents
- [ ] Keyboard shortcuts on desktop
- [ ] Cost tracking (tokens used per agent)
- [ ] Auto-spawn based on triggers

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

## Open Questions

- [ ] Best way to handle ANTHROPIC_API_KEY? Env var on server?
- [ ] Should we support multiple users or assume single-user?
- [ ] File watching to auto-detect repos in ~/git/?
