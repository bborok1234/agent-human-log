---
name: daily
description: "Generate today's daily summary — analyze sessions, git commits, and write to Obsidian."
allowed-tools:
  - mcp__agent-human-log__daily_summary
---

# Daily Summary

Generate the daily work summary on demand.

## Steps

1. Call `mcp__agent-human-log__daily_summary` (defaults to today, or pass a specific date if the developer specifies one)
2. Present the result to the developer

## Rules

- This is a manual trigger for the daily summary generation
- The tool handles everything: session analysis, git log, LLM summarization, Obsidian writing, SQLite persistence
- Just call it and show the output. No extra steps needed.
- If the developer asks for a specific date, pass it as the `date` parameter
