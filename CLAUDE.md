# CLAUDE.md

Behavioral rules for Claude Code in the claude-code-hub repository.

## Project Overview

Simple orchestration hub for Claude Code agents.

**The problem:** Running multiple Claude Code agents means multiple terminal windows. You can't easily check on them from your phone while away from your desk.

**The solution:** A server that spawns agents via the Agent SDK, tracks their status, and exposes an API for UIs to connect. Works over tailscale for phone access.

### Architecture

```
[Your phone] --tailscale--> [Hub server on your machine]
                                    |
                    +---------------+---------------+
                    |               |               |
              [Agent: moss]   [Agent: spore]  [Agent: resin]
              (cwd: ~/git/moss)  ...            ...
```

### What This Is Not

- Not "swarm intelligence" or "hive mind orchestration"
- Not dozens of specialized agents
- Not enterprise anything

Just the glue needed to run a few agents across your repos and check on them from your phone.

## Core Requirements

1. **Works over tailscale** - just HTTP/WebSocket on a port
2. **Multi-agent** - spawn to different working directories, each gets its own CLAUDE.md
3. **Simple** - minimal code, you can read and understand all of it
4. **Mobile-friendly UI** - the whole point is phone access

## Development

```bash
npm install
npm run dev    # development with hot reload
npm start      # production
```

Server runs on `http://localhost:3000` by default. Access via tailscale IP from phone.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agents` | POST | Spawn new agent with `{ "cwd": "...", "prompt": "..." }` |
| `/agents` | GET | List all agents and status |
| `/agents/:id` | GET | Get agent details and recent output |
| `/agents/:id/message` | POST | Send follow-up message to agent |
| `/ws` | WebSocket | Real-time updates for all agent activity |

## Core Rule

**Note things down immediately:**
- Bugs/issues → fix or add to TODO.md
- Design decisions → docs/ or code comments
- Future work → TODO.md
- Key insights → this file

**Do the work properly.** When asked to analyze X, actually read X - don't synthesize from conversation.

## Behavioral Patterns

From ecosystem-wide session analysis:

- **Question scope early:** Before implementing, ask whether it belongs in this module
- **Check consistency:** Look at how similar things are done elsewhere in the codebase
- **Implement fully:** No silent arbitrary caps or incomplete features
- **Name for purpose:** Avoid names that describe one consumer
- **Verify before stating:** Don't assert API behavior or codebase facts without checking

## Commit Convention

Use conventional commits: `type(scope): message`

Types:
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `docs` - Documentation only
- `chore` - Maintenance (deps, CI, etc.)
- `test` - Adding or updating tests

## Negative Constraints

Do not:
- Announce actions ("I will now...") - just do them
- Leave work uncommitted
- Over-engineer - this is glue code, keep it simple
- Add "enterprise" features - YAGNI
- Use path dependencies in Cargo.toml - causes clippy to stash changes across repos
- Use `--no-verify` - fix the issue or fix the hook
- Assume tools are missing - check if `nix develop` is available for the right environment
