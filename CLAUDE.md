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

**Triggers:** User corrects you, 2+ failed attempts, "aha" moment, framework quirk discovered → document before proceeding.

**Conversation is not memory.** Anything said in chat evaporates at session end. If it implies future behavior change, write it to CLAUDE.md or a memory file immediately — or it will not happen.

**Warning — these phrases mean something needs to be written down right now:**
- "I won't do X again" / "I'll remember to..." / "I've learned that..."
- "Next time I'll..." / "From now on I'll..."
- Any acknowledgement of a recurring error without a corresponding CLAUDE.md or memory edit

**When the user corrects you:** Ask what rule would have prevented this, and write it before proceeding. **"The rule exists, I just didn't follow it" is never the diagnosis** — a rule that doesn't prevent the failure it describes is incomplete; fix the rule, not your behavior.

**Something unexpected is a signal, not noise.** Surprising output, anomalous numbers, files containing what they shouldn't — stop and ask why before continuing. Don't accept anomalies and move on.

**Do the work properly.** When asked to analyze X, actually read X - don't synthesize from conversation.

## Behavioral Patterns

From ecosystem-wide session analysis:

- **Question scope early:** Before implementing, ask whether it belongs in this module
- **Check consistency:** Look at how similar things are done elsewhere in the codebase
- **Implement fully:** No silent arbitrary caps or incomplete features
- **Name for purpose:** Avoid names that describe one consumer
- **Verify before stating:** Don't assert API behavior or codebase facts without checking

## Workflow

**Minimize file churn.** When editing a file, read it once, plan all changes, and apply them in one pass.

**Always commit completed work.** After tests pass, commit immediately — don't wait to be asked. When a plan has multiple phases, commit after each phase passes. Uncommitted work is lost work.

## Context Management

**Use subagents to protect the main context window.** For broad exploration or mechanical multi-file work, delegate to an Explore or general-purpose subagent rather than running searches inline. The subagent returns a distilled summary; raw tool output stays out of the main context.

Rules of thumb:
- Research tasks (investigating a question, surveying patterns) → subagent; don't pollute main context with exploratory noise
- Searching >5 files or running >3 rounds of grep/read → use a subagent
- Codebase-wide analysis (architecture, patterns, cross-file survey) → always subagent
- Mechanical work across many files (applying the same change everywhere) → parallel subagents
- Single targeted lookup (one file, one symbol) → inline is fine

## Session Handoff

Use plan mode as a handoff mechanism when:
- A task is fully complete (committed, pushed, docs updated)
- The session has drifted from its original purpose
- Context has accumulated enough that a fresh start would help

**For handoffs:** enter plan mode, write a short plan pointing at TODO.md, and ExitPlanMode. **Do NOT investigate first** — the session is context-heavy and about to be discarded. The fresh session investigates after approval.

**For mid-session planning** on a different topic: investigating inside plan mode is fine — context isn't being thrown away.

Before the handoff plan, update TODO.md and memory files with anything worth preserving.

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
- Use interactive git commands (`git add -p`, `git add -i`, `git rebase -i`) — these block on stdin and hang in non-interactive shells; stage files by name instead
- Over-engineer - this is glue code, keep it simple
- Add "enterprise" features - YAGNI
- Use path dependencies in Cargo.toml - causes clippy to stash changes across repos
- Use `--no-verify` - fix the issue or fix the hook
- Assume tools are missing - check if `nix develop` is available for the right environment
