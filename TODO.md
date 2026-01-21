# TODO

## Current Status

Scaffolded. Server and UI are stubbed. Agent SDK integration is placeholder.

## Phase 1: Basic Functionality

- [ ] Install and wire up `@anthropic-ai/claude-agent-sdk`
- [ ] Implement actual agent spawning with `query()`
- [ ] Pass `workingDirectory` option to spawn agents in different repos
- [ ] Stream agent messages to WebSocket subscribers
- [ ] Handle agent completion and errors properly
- [ ] Test with a single agent end-to-end

## Phase 2: Multi-Agent

- [ ] Spawn multiple agents simultaneously
- [ ] Each agent gets its own CLAUDE.md from its working directory
- [ ] Track all agents independently
- [ ] UI shows all agents, can expand/collapse each
- [ ] Test with 3-4 agents across different repos

## Phase 3: Session Management

- [ ] Capture session IDs from agents
- [ ] Implement session resumption for follow-up messages
- [ ] POST /agents/:id/message sends to existing session
- [ ] Handle "waiting for input" state
- [ ] Persist sessions across server restarts (SQLite?)

## Phase 4: Mobile Polish

- [ ] Test UI on actual phone over tailscale
- [ ] Touch-friendly interactions
- [ ] Pull-to-refresh
- [ ] Notifications when agent needs input or completes?
- [ ] Dark/light mode based on system preference

## Phase 5: Quality of Life

- [ ] Agent presets (common repos + prompts)
- [ ] Quick-spawn buttons for frequent tasks
- [ ] Recent agents history
- [ ] Search/filter agents
- [ ] Keyboard shortcuts on desktop

## Phase 6: Advanced (Maybe)

- [ ] Agent-to-agent awareness (agent A can see agent B exists)
- [ ] Coordinated tasks ("update logging in all repos")
- [ ] Auto-spawn based on triggers
- [ ] Cost tracking (tokens used per agent)

## Non-Goals

- Swarm intelligence
- Self-learning neural capabilities
- 54+ specialized agents
- Enterprise anything
- Replacing Claude Code - just orchestrating it

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
- [ ] Integration with this repo's ecosystem coordination?
