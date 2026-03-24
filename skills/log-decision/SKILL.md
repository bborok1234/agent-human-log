---
name: log-decision
version: 0.1.0
description: "Record a decision made during work — what was chosen, why, and what tradeoffs were accepted."
allowed-tools:
  - log_decision
---

# Log Decision

Record a decision the developer just made or is about to make.

## How to Use

The developer will describe a decision in natural language. Extract the structured fields and call `log_decision`.

## Required Fields
- **title**: One-line summary of the decision (under 50 chars)
- **rationale**: Why this option was chosen

## Optional Fields (ask only if the developer mentioned them)
- **project**: Which project this applies to
- **context**: What situation led to this decision
- **alternatives**: What other options were considered
- **chosen**: The specific option selected
- **tradeoff**: Known downsides or tradeoffs

## Examples

Developer says: "Redis로 세션 스토어 가기로 함. stateless JWT는 revocation이 너무 복잡해"
→ Call log_decision with:
  - title: "세션 스토어로 Redis 선택"
  - rationale: "stateless JWT는 revocation이 복잡"
  - alternatives: ["stateless JWT", "Redis session store"]
  - chosen: "Redis session store"
  - tradeoff: "인프라 의존성 추가"

## Rules

- Do NOT ask 5 questions one by one. Extract what you can from the developer's words, fill in the rest.
- If the developer gave a one-liner, that's enough for title + rationale. Don't force more.
- Confirm the recorded decision briefly after logging.
