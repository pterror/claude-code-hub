# claude-code-hub

Simple orchestration hub for Claude Code agents.

## Why

1. **The dinner problem** - You want to eat dinner, but your agents are running upstairs. Check on them from your phone.

2. **The 6 terminals problem** - Multiple agents = multiple terminals. Zoomed out, squished, barely usable. A list scales. Terminals don't.

## What

- Server that spawns Claude Code agents (via Agent SDK)
- Tracks their status
- Web UI for viewing/interacting
- Works over tailscale

## Quick Start

```bash
bun install
bun run dev
```

Access at `http://localhost:3000` or via your tailscale IP from phone.

## Not

- Not "swarm intelligence"
- Not 54+ specialized agents
- Not 250k lines of code
- Not enterprise anything

Just the glue needed to run a few agents and check on them from your phone.
