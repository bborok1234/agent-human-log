# agent-human-log

AI 작업 세션을 자동으로 분석하고 Obsidian 일일 노트로 기록하는 도구.
Claude Code / OpenCode 세션 + git 커밋을 수집해서 하루 작업을 요약하고, 결정 기록과 이월 항목을 추적합니다.

## 주요 기능

- LLM 기반 일일/주간 작업 요약 (프로젝트별 그룹화)
- 결정 기록 (Decision Journal) — 선택/이유/트레이드오프 구조화
- Carry Forward — 미완료 작업 자동 이월 + 완료 추적
- 세션 흐름 분석 — 도구 사용 패턴으로 investigation/implementation/refactoring 자동 분류
- 추천 엔진 — 과거 데이터 기반 오늘 우선순위 제안
- Obsidian 네이티브 — frontmatter, wikilink, callout, Dataview 쿼리 지원

## 설치

```bash
git clone https://github.com/bborok1234/agent-human-log.git
cd agent-human-log
npm install
npm run build
```

## 설정

### 1. config 파일

```bash
cp config/config.example.json config/config.json
```

`config/config.json`을 열고 본인 환경에 맞게 수정:

```jsonc
{
  "obsidian": {
    "vaultPath": "~/your-obsidian-vault",  // Obsidian 볼트 경로
    "dailyNotesDir": "Daily Notes",
    "dateFormat": "YYYY-MM-DD"
  },
  "git": {
    "repos": [
      "~/projects/my-repo-1",              // 추적할 git 레포 경로들
      "~/projects/my-repo-2"
    ],
    "authorEmail": "you@example.com"        // git author 이메일
  },
  "session": {
    "claudeCodeDir": "~/.claude/projects",
    "openCodeDb": "~/.local/share/opencode/opencode.db"
  },
  "summarizer": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "maxTokens": 500
  }
}
```

### 2. API 키

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

### 3. Claude Code에 MCP 서버 등록

```bash
npm run setup
```

Claude Code를 재시작하면 MCP 도구와 슬래시 커맨드가 활성화됩니다.

## 사용법

### 슬래시 커맨드 (Claude Code 안에서)

| 커맨드 | 설명 |
|--------|------|
| `/morning` | 아침 브리핑 — 어제 요약 + 오늘 추천 + 포커스 설정 |
| `/daily` | 일일 요약 생성 (세션 분석 + git + LLM 요약) |
| `/log-decision` | 작업 중 결정 기록 ("Redis 선택, JWT는 revocation 복잡") |
| `/search` | 과거 기록 검색 ("auth 관련 결정", "지난주 luffy") |
| `/work-logger` | 백그라운드 마일스톤 자동 기록 |

### CLI (터미널에서)

```bash
npm run daily              # 오늘 일일 요약 생성
npm run weekly             # 이번 주 주간 요약 생성
node dist/cli/index.js recommend   # 오늘 추천 확인
```

### MCP 도구 (에이전트가 직접 호출)

| 도구 | 설명 |
|------|------|
| `daily_summary` | 일일 요약 생성 → Obsidian + SQLite 저장 |
| `weekly_summary` | 주간 요약 생성 |
| `log_milestone` | 작업 마일스톤 기록 |
| `log_decision` | 결정 기록 (title, rationale, tradeoff) |
| `search_history` | 과거 기록 검색 (summary + decisions + carry items) |
| `get_yesterday` | 어제 요약 + carry forward 조회 |
| `set_focus` | 오늘 포커스 설정 |
| `get_recommendations` | 우선순위 추천 |
| `resolve_carry_item` | 이월 항목 완료/폐기 처리 |

## Obsidian 연동

일일 노트에 자동 생성되는 frontmatter:

```yaml
---
date: 2026-03-24
type: daily-log
projects:
  - "[[my-project]]"
commits: 12
sessions: 5
hours: 4.5
work-types:
  - feature
  - refactor
flow-distribution:
  investigation: 30
  implementation: 50
  verification: 20
time-blocks:
  - start: "09:00"
    end: "12:30"
    project: my-project
---
```

Dataview 쿼리 예시:
```dataview
TABLE commits, hours, work-types
FROM "Daily Notes"
WHERE type = "daily-log"
SORT date DESC
LIMIT 14
```

## 기술 스택

- TypeScript + Node.js 20+
- better-sqlite3 (메모리 스토어)
- @anthropic-ai/sdk (LLM 요약)
- @modelcontextprotocol/sdk (MCP 서버)
- Obsidian (마크다운 노트 출력)

## 라이선스

MIT
