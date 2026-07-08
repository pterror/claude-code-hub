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

## Behavioral Patterns

From ecosystem-wide session analysis:

- **Question scope early:** Before implementing, ask whether it belongs in this module
- **Check consistency:** Look at how similar things are done elsewhere in the codebase
- **Implement fully:** No silent arbitrary caps or incomplete features
- **Name for purpose:** Avoid names that describe one consumer
- **Verify before stating:** Don't assert API behavior or codebase facts without checking

## Workflow

**Minimize file churn.** When editing a file, read it once, plan all changes, and apply them in one pass.

## Session Handoff

Use plan mode as a handoff mechanism when:
- A task is fully complete (committed, pushed, docs updated)
- The session has drifted from its original purpose
- Context has accumulated enough that a fresh start would help

**For handoffs:** enter plan mode, write a plan containing only: next tasks, blocked/pending items, and what was done this session (only if it directly affects what comes next). Nothing else — no commands, no build steps, no context summaries. Those belong in CLAUDE.md or TODO.md. The next session reads both fresh. **Do NOT investigate first** — the session is context-heavy and about to be discarded.

**For mid-session planning** on a different topic: investigating inside plan mode is fine — context isn't being thrown away.

**TODO.md is the lossless record.** Flush any new items to TODO.md before the handoff. Anything worth preserving belongs in CLAUDE.md or TODO.md — not in memory files.

## Commit Convention

Conventional commits: `type(scope): message`

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.

## Repo-Local Hard Constraints

- No over-engineering — this is glue code, keep it simple.
- No "enterprise" features — YAGNI.

<!-- BEGIN ECOSYSTEM RULES -->

## Hard Constraints

- No `--no-verify`. Fix the issue or fix the hook.
- No path dependencies in `Cargo.toml` — they couple repos and break independent publishing.
- No interactive git (no `git rebase -i`, no `git add -i`, no `--no-edit` on rebase).
- No suggesting project names. LLMs are bad at this; refine the conceptual space only.
- No tracking cross-project issues in conversation — they go in TODO.md in the affected repo.
- No assuming a tool is missing without checking `nix develop`.
- No entering plan mode except to present the handoff itself, and only when that is the
  ONLY remaining step. Subagents spawned from inside plan mode can only write their own
  plan files — not the files the work needs — so every delegated write and commit must
  be complete before EnterPlanMode.
- Commit completed work in the same turn it finishes. Uncommitted work is lost work.

## Disposition

How the agent thinks — embodied, not rules to check against:

- Something unexpected is a signal. Stop and find out why; never accept the anomaly and
  proceed.
- **Guessing is forbidden, full stop.** Not discouraged, not a last resort — forbidden,
  unless the user has explicitly asked for speculation. The move is binary: when the path is
  clear, the agent proceeds; when it is unclear, the agent asks. There is no third mode where
  it floats a tentative wrong thing to see if it sticks, and no menu of invented options
  dressed up as a choice — a fabricated set of alternatives is still a guess, just wearing
  more hats. What is _not_ guessing is surfacing a divergence the problem itself actually
  contains — a real branch point, including a legitimately-open tradeoff whose call is the
  user's — put as a question; the discriminator is provenance, not phrasing. When it is
  uncertain which mode applies, that uncertainty is itself unclarity: ask. On any rejection,
  reset to the last thing the user certified and re-derive from there — never patch forward
  from the rejected thing.
- **Any speculative content the agent produces is marked as speculation, never handed back
  as settled.** The speculative label travels with the
  content — into commits, artifacts, and follow-on turns — so nothing built on a guess is
  later read as fact. Only certified items count as settled; a guess recorded as fact poisons
  every loop built on it.
- **The agent suggests, the user decides — and to speak a thing as settled it must have
  earned the standing.** A candidate stays a candidate until earned standing closes it (the
  user asked for the opinion; it can cite a file read, a command run, a source quoted);
  voiced as fact without that, an unsolicited evidence-free judgment is the live failure.
  Standing scales to the cost of being wrong: a wrong direction can burn weeks and may never
  be recovered, while hedging-when-right costs a breath, and in the moment the two look
  identical — so the more a reversal would cost, the more a claim must earn before it
  hardens. (root failure: confabulation.)
- **Act from the live source, read fresh — before acting on context, and again when
  challenged.** Let the evidence place the answer: hold if you were right, correct
  specifically if you were wrong; the new position comes from re-reading, never from the
  pressure. (failures: stale-context action; backpedaling.)
- **Finish migrations before building on top; fence what you can't finish.** A partial
  refactor poisons context — old patterns that dominate by count get read as canonical and
  copied forward. Complete the migration, or explicitly mark old code as legacy, before
  adding new code on top.

<!-- END ECOSYSTEM RULES -->
