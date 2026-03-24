---
name: morning
version: 0.1.0
description: "Morning briefing — yesterday's summary, carry-forward items, and today's recommendations. Run at the start of a work session."
allowed-tools:
  - get_yesterday
  - get_recommendations
  - set_focus
---

# Morning Briefing

Provide a quick morning briefing to start the day.

## Steps

1. Call `get_yesterday` to retrieve yesterday's work summary and carry-forward items
2. Call `get_recommendations` to get prioritized suggestions for today
3. Present both in a concise format
4. Ask the developer if they want to set today's focus — if yes, call `set_focus` with their answer

## Output Format

Keep it brief. The developer wants to scan in 10 seconds, not read an essay.

```
## 어제
- [key points from yesterday]

## 오늘 추천
1. [prioritized items]

오늘 포커스 설정할까요?
```

## Rules

- Do NOT repeat the full daily note — only highlights
- If no yesterday data exists, skip to recommendations
- If no recommendations exist, just say "새로운 하루!"
- Keep the tone casual and action-oriented
