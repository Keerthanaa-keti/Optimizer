# CreditForge - Claude Subscription Optimizer

Autonomous task scanner and executor that maximizes Claude subscription value by discovering and running tasks during off-hours.

## Tech Stack
- TypeScript + Node.js monorepo (npm workspaces)
- SQLite via better-sqlite3
- Claude CLI (`claude -p`) for task execution
- launchd for macOS scheduling

## Project Structure

```
optimizer/
├── packages/
│   ├── core/          # Domain types, ledger, governor, pool protocol
│   ├── db/            # SQLite schema, migrations, typed queries
│   ├── scanner/       # Task discovery (5 source detectors)
│   └── executor/      # Claude CLI wrapper, night planner
├── apps/
│   └── cli/           # CLI entry points (scan, run, status)
├── launchd/           # macOS launchd plist files
├── creditforge.toml   # User configuration
└── logs/              # Execution logs
```

## Key Concepts
- **Task Scanner**: Discovers automatable micro-tasks from CLAUDE.md, TODO comments, bugs-codex.md, npm audit, git state, package.json scripts
- **Night Mode**: Executes queued tasks during off-hours (11PM-6AM) on `nightmode/` branches
- **Credit Governor**: Enforces 75% spending cap, greedy knapsack batch optimization
- **Double-entry Ledger**: Tracks all credit usage, designed for future P2P token marketplace

## CLI Commands
- `creditforge scan` — Scan configured projects for tasks
- `creditforge run --task <id>` — Execute a single task
- `creditforge run --mode night [--dry-run]` — Night mode batch execution
- `creditforge status` — Show status dashboard
- `creditforge status --report` — Show morning report

## Safety Rules
- All night mode changes go to `nightmode/YYYY-MM-DD` branches, never main
- No pushes to remote — user reviews in the morning
- GitCode/office projects are never scanned or modified
- Max 75% of remaining credits consumed per night session
- $0.50 cap per individual task

## Setup
```bash
cd ~/Documents/ClaudeExperiments/optimizer
npm install          # installs better-sqlite3, @types/better-sqlite3
npm run build        # compiles all packages
node apps/cli/dist/index.js scan   # test it
```

## Development Rules

### Planning & Scope
- Work section by section, not everything at once
- Mark each section complete after successful implementation
- Keep a "parking lot" list for out-of-scope ideas — don't expand scope mid-section
- Commit each working section to Git before moving to the next

### Version Control
- Use Git religiously — don't rely solely on AI undo
- Start each new feature on a clean Git slate
- If stuck or AI goes on a tangent: `git reset --hard HEAD` and start fresh
- Avoid cumulative problems — multiple failed attempts create layers of bad code
- When you find the fix, reset and implement it cleanly

### Testing
- Prioritize end-to-end integration tests over unit tests
- Simulate real user behavior (e.g. running CLI commands, checking DB state)
- Test before proceeding — ensure each section passes before moving on
- Catch regressions — verify unrelated logic isn't broken after changes
- Use tests as guardrails to provide clear boundaries

### Bug Fixing
- Leverage error messages — copy-paste the full error, often enough context
- Analyze before coding — consider multiple possible causes
- Reset after failures — start with a clean slate after each unsuccessful fix
- Add strategic logging to understand what's happening
- If one model gets stuck, try a different model (sonnet vs opus vs haiku)
- Once you identify the fix, reset and implement it on a clean codebase

### Code Quality
- Small, modular files — no files over 300 lines
- Clear boundaries between packages — consistent external APIs
- Refactor frequently once tests are in place
- Avoid large monolithic files; split into focused modules

## Current Status
- Phase 0: Scanner + Night Mode (built and tested, 164 tasks discovered)
- Phase 1: Tauri menubar app (planned)
- Phase 2: Intelligence layer (planned)
- Phase 3: TokenPool marketplace (planned)

## Next Steps
- [ ] Validate night mode dry-run
- [ ] Test single task execution
- [ ] Install launchd agents
- [ ] Build Tauri menubar app (Phase 1)
