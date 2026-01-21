# claude-code-hub

Simple orchestration hub for Claude Code agents.

## Why This Exists

**The dinner problem:** You're working with Claude Code agents on your desktop. You want to eat dinner downstairs. Currently you either abandon your agents or bring dinner to your desk.

**The 6 terminals problem:** Running multiple agents means multiple terminal windows. Squished, zoomed out, barely usable. Adding a 7th? Just cope.

## What This Is

A server that:
- Spawns Claude Code agents (via Agent SDK) to different working directories
- Tracks their status
- Exposes an API for UIs to connect
- Works over tailscale - access from your phone

Plus a reference web UI that:
- Shows all running agents
- Lets you interact with any of them
- Works on mobile

## What This Is Not

- Not "swarm intelligence" or "hive mind orchestration"
- Not 54+ specialized agents
- Not 250k lines of code
- Not enterprise anything

Just the glue needed to run a few agents across your repos and check on them from your phone.

## Architecture

```
[Your phone] --tailscale--> [Hub server on your machine]
                                    |
                    +---------------+---------------+
                    |               |               |
              [Agent: moss]   [Agent: spore]  [Agent: resin]
              (cwd: ~/git/moss)  ...            ...
```

The server uses the Claude Agent SDK. Each agent is a real Claude Code instance with full capabilities.

## Core Requirements

1. **Works over tailscale** - just HTTP/WebSocket on a port
2. **Multi-agent** - spawn to different working directories, each gets its own CLAUDE.md
3. **Simple** - minimal code, you can read and understand all of it
4. **Mobile-friendly UI** - the whole point is phone access

## Running

```bash
npm install
npm run dev    # development with hot reload
npm start      # production
```

Server runs on `http://localhost:3000` by default. Access via tailscale IP from phone.

## API

### POST /agents
Spawn a new agent.
```json
{ "cwd": "~/git/moss", "prompt": "update logging format" }
```

### GET /agents
List all agents and their status.

### GET /agents/:id
Get agent details and recent output.

### POST /agents/:id/message
Send a follow-up message to an agent.

### WebSocket /ws
Real-time updates for all agent activity.
