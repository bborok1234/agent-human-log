# AGENT-HUMAN-LOG

**Personal AI work companion for people who hate logging.**

Auto-captures work from AI coding sessions + git, compresses into a few lines, remembers priorities across days, and visualizes productivity over time. Designed for developers who use AI agents (OpenCode, Claude Code, Codex) as their primary coding workflow.

## OVERVIEW

TypeScript MCP server + CLI. Reads OpenCode/Claude Code session data + git logs, summarizes via LLM, writes to Obsidian daily notes. Not a todo app. Not a time tracker. A work companion that remembers what you did so you don't have to.

**Core insight**: OpenCode session user messages contain the developer's _intent_ ("I need to fix the XSS vulnerability by moving tokens to httpOnly"). This is richer than git commits ("auth/jwt.ts +45/-12"). We extract the human's own words, not generate synthetic summaries.

## STRUCTURE

```
agent-human-log/
├── src/
│   ├── mcp-server/       # MCP server — tools Claude/OpenCode can call
│   │   └── index.ts      # Entry point, tool registration
│   ├── analyzers/         # Data source parsers
│   │   ├── session.ts     # OpenCode/Claude Code session log parser
│   │   └── git.ts         # Multi-repo git log parser
│   ├── summarizer/        # LLM-based compression
│   │   └── index.ts       # Session + git → few lines
│   ├── cli/               # Standalone CLI commands
│   │   ├── index.ts       # CLI entry point
│   │   └── daily-summary.ts
│   └── types/             # Shared type definitions
│       └── index.ts
├── skills/                # OpenCode skills (markdown)
│   └── work-logger/
│       └── SKILL.md       # Agent behavior: log milestones during work
├── config/
│   └── config.example.json
├── AGENTS.md              # This file
├── package.json
└── tsconfig.json
```

## ARCHITECTURE

### Data Flow (Phase 1)

```
Data Sources              Analyzers              Summarizer           Output
┌──────────────┐    ┌─────────────────┐    ┌──────────────┐    ┌──────────────┐
│ OpenCode     │───>│ session.ts      │───>│              │    │ Obsidian     │
│ sessions     │    │ (JSONL + SQLite) │    │ summarizer/  │───>│ daily note   │
│ (~/.claude/) │    └─────────────────┘    │ index.ts     │    │ (YYYY-MM-DD  │
│              │    ┌─────────────────┐    │              │    │  .md)        │
│ Git repos    │───>│ git.ts          │───>│ (LLM compress│    └──────────────┘
│ (configured) │    │ (git log --stat)│    │  to few lines│
└──────────────┘    └─────────────────┘    └──────────────┘
```

### MCP Tools (exposed to Claude/OpenCode)

| Tool | Purpose | Phase |
|------|---------|-------|
| `daily_summary` | Generate today's summary → write to Obsidian | 1 |
| `log_milestone` | Append a work entry to today's note mid-session | 1 |
| `get_yesterday` | Retrieve yesterday's summary + carry forward | 1 |
| `set_focus` | Set today's focus items (morning, 30 sec) | 2 |
| `get_recommendations` | AI recommends today's priorities based on history | 2 |

### Session Data Sources

**Claude Code**: `~/.claude/projects/**/*.jsonl` — one JSONL file per project session
**OpenCode**: `~/.local/share/opencode/opencode.db` — SQLite database
**Git**: `git log --since="6am" --stat --format=...` across configured repo paths

### Obsidian Daily Note Format

```markdown
# YYYY-MM-DD

## Focus
<!-- Morning: 30 seconds, optional manual input -->

## Yesterday
<!-- Auto: compressed summary from previous day's sessions + git -->

## Work Log
<!-- Auto: append-only, timestamped milestones -->
- HH:MM [project] description

## Carry Forward
<!-- Auto: extracted from open todos, open branches, incomplete work -->

## Stats
<!-- Auto: N commits · N files · +N/-N · N sessions · ~Nh -->
```

**Insertion rule**: Check if section exists → replace content. If not → insert at known anchor. Idempotent.

## PHASE PLAN

### Phase 1 — Daily Summary (MVP)
- MCP server with `daily_summary`, `log_milestone`, `get_yesterday`
- Session analyzer (Claude Code JSONL + OpenCode SQLite)
- Git analyzer (multi-repo, configured paths)
- LLM summarizer (compress to few lines)
- Obsidian writer (daily note append/create)
- OpenCode skill for auto-logging during sessions

### Phase 2 — Memory + Recommendations
- Persistent memory store (SQLite) for priorities, schedules
- `set_focus` and `get_recommendations` tools
- Cross-day context: carry forward, recurring themes
- Morning brief: "Here's what you said was important"

### Phase 3 — Visualization
- Web dashboard (activity heatmap, weekly/monthly/yearly views)
- Obsidian Dataview-compatible frontmatter for in-vault queries
- Productivity patterns: focus time, context switches, project distribution

## CONVENTIONS

### Code Style
- TypeScript strict mode, no `any`
- ES modules (`"type": "module"` in package.json)
- Zod for runtime validation (MCP tool inputs, config)
- Explicit error handling — no empty catch blocks
- `console.error()` for logging in MCP server (stdout = JSON-RPC)

### File Naming
- `kebab-case.ts` for files
- `PascalCase` for types/interfaces
- `camelCase` for functions/variables

### MCP Server Patterns
- Use `@modelcontextprotocol/sdk` v2 API
- `McpServer` + `StdioServerTransport`
- `server.registerTool(name, { description, inputSchema: z.object({...}) }, handler)`
- Tools return `{ content: [{ type: 'text', text: '...' }] }`

### Testing
- Vitest (when tests are added)
- Test analyzers with fixture JSONL/SQLite data
- Test MCP tools with mock session data

## ANTI-PATTERNS

- **DO NOT** build a todo app. This is a passive work companion.
- **DO NOT** require manual input for core functionality. Everything works with zero human effort.
- **DO NOT** send raw session logs to cloud LLMs. Summarize locally first, send compressed content.
- **DO NOT** overwrite user-written sections in Obsidian notes. Only touch auto-generated sections.
- **DO NOT** use `console.log()` in MCP server code. Stdout is reserved for JSON-RPC.
- **DO NOT** hardcode vault paths. All paths come from config.

## CONFIG

```json
{
  "obsidian": {
    "vaultPath": "~/Documents/MyVault",
    "dailyNotesDir": "Daily Notes",
    "dateFormat": "YYYY-MM-DD"
  },
  "git": {
    "repos": [
      "~/projects/my-app",
      "~/projects/api-client"
    ],
    "authorEmail": "me@example.com"
  },
  "session": {
    "claudeCodeDir": "~/.claude/projects",
    "openCodeDb": "~/.local/share/opencode/opencode.db"
  },
  "summarizer": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 500
  }
}
```

## COMMANDS

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode
npm run start          # Run MCP server (stdio)
npm run daily          # CLI: generate today's summary
npm run typecheck      # Type check without emit
```

## NOTES

- The user (project owner) is bad at record-keeping by self-admission. Every UX decision should optimize for zero-friction.
- "A few lines" is the target density. Even a day with 30 commits should compress to 3-5 meaningful lines.
- Session user messages > git commits for signal quality. Extract the human's words.
- Obsidian is just markdown files on disk. No API needed, no Obsidian running required.
- MCP server runs as stdio process, registered in `.mcp.json` or `~/.claude.json`.
