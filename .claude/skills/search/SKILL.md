---
name: search
description: "Search past work history — summaries, decisions, and carry-forward items."
allowed-tools:
  - mcp__agent-human-log__search_history
---

# Search History

Search the developer's past work records.

## How to Use

The developer will ask a natural language question. Extract keywords and optional filters, then call `mcp__agent-human-log__search_history`.

## Examples

- "auth 관련 결정 뭐 있었지?" → query: "auth"
- "luffy에서 지난주 뭐 했지?" → query: "%", project: "luffy", days: 7
- "CSRF 관련 작업" → query: "CSRF"
- "캐리 포워드 중에 테스트 관련" → query: "테스트"

## Output Format

Present results grouped by date, with type indicators:
- ⚖️ Decision
- 📝 Summary
- 📋 Carry Forward

## Rules

- If the query is too broad and returns too many results, suggest narrowing by project or date range
- If no results found, suggest alternative keywords
- Keep the presentation concise — the developer wants to find information quickly
