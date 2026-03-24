# ROADMAP — Agent Human Log

> 목표: 로컬 Obsidian을 최대한 활용하는 개인 생산성 툴.
> 의미 있는 로깅과 의도 추출에 집중하여, 나중에 돌아봤을 때 가치 있는 기록을 만든다.

## 현재 상태

Phase 1 MVP 완료 (v0.1.0):
- Claude Code JSONL + OpenCode SQLite 세션 파싱
- 멀티 레포 git log 분석
- LLM 기반 3-5줄 일일 요약 압축
- Obsidian 일일 노트 생성/섹션 교체 (멱등)
- MCP 도구 3개 (`daily_summary`, `log_milestone`, `get_yesterday`)
- CLI (`ahl daily`)

## 개선 원칙

1. **의도(intent) > 행동(action) > 기계적 기록**: "왜 했는가"가 "무엇을 했는가"보다 가치 있다
2. **Obsidian 네이티브**: frontmatter, wikilink, Dataview, callout 등 Obsidian 고유 기능 적극 활용
3. **제로 프릭션 유지**: 자동화 우선, 수동 입력은 선택적(optional)으로만
4. **로컬 퍼스트**: 클라우드 의존 최소화, LLM 호출 전 로컬에서 최대한 정리
5. **작업 단위는 에이전트 스케일**: PR 하나가 사람 기준 여러 PR 분량 (에이전트가 한 번에 구현 가능한 범위)

---

## PR #5 — 의도 추출 강화 + Obsidian 메타데이터

> 핵심: 요약 품질을 근본적으로 올리는 변경. 현재 버려지고 있는 신호들을 수집하고,
> Obsidian의 구조화 기능을 활용해 쿼리 가능한 데이터로 만든다.

### 5-A. 풍부한 메시지 추출 (summarizer 개선)

**문제**: user message 첫 줄만 200자로 잘라서 LLM에 전달. 맥락의 대부분이 손실됨.

**변경 사항**:
- `extractCleanMessages()` — 첫 줄 truncation 제거, 전체 메시지 전달 (단, 토큰 예산 관리)
- 메시지당 최대 500자, 전체 최대 8000자 (LLM 입력 비용 제어)
- 멀티라인 메시지에서 핵심 의도 문장 보존 (첫 줄이 아닌 의미 있는 줄)
- 시스템 노이즈 필터링 패턴 확장 (hook output, agent_progress 등)

**파일**: `src/summarizer/index.ts`

### 5-B. Tool use 신호 추출

**문제**: assistant의 tool_use 블록이 완전히 무시됨. 어떤 파일을 편집했고 어떤 명령을 실행했는지 로그에 없음.

**변경 사항**:
- `src/analyzers/session.ts` — JSONL에서 assistant tool_use 블록 파싱 추가
  - `Edit`/`Write` → 편집된 파일 경로 목록 추출
  - `Bash` → 실행된 명령 중 의미 있는 것 추출 (test, build, deploy 등)
  - `Read`/`Grep`/`Glob` → 조사 대상 파일/패턴 (investigation 신호)
- `SessionEntry` 타입 확장:
  ```typescript
  filesEdited: string[];      // Edit/Write 대상 파일 경로
  commandsRun: string[];      // Bash 명령 중 의미 있는 것
  toolUseCounts: Record<string, number>;  // 도구별 호출 횟수
  ```
- summarizer에 tool use 데이터를 LLM 입력에 포함

**파일**: `src/analyzers/session.ts`, `src/types/index.ts`, `src/summarizer/index.ts`

### 5-C. Obsidian frontmatter + wikilink

**문제**: frontmatter 없어서 Dataview 쿼리 불가. 프로젝트명이 plain text라 그래프 뷰 무용.

**변경 사항**:
- `src/obsidian/writer.ts` — 일일 노트에 YAML frontmatter 추가:
  ```yaml
  ---
  date: 2026-03-24
  type: daily-log
  projects:
    - "[[luffy]]"
    - "[[agent-human-log]]"
  commits: 12
  sessions: 5
  hours: 4.5
  files-edited:
    - src/auth/jwt.ts
    - src/middleware/session.ts
  work-types:
    - bugfix
    - feature
  ---
  ```
- Summary 섹션의 프로젝트명을 `[[wikilink]]`로 변환
- frontmatter 생성/업데이트 로직 (기존 노트의 frontmatter 보존)

**파일**: `src/obsidian/writer.ts`, `src/types/index.ts`

### 5-D. LLM 프롬프트 개선 — 작업 유형 태깅 + 결정 기록

**문제**: 프롬프트가 "요약해줘"만 요청. 작업 유형 분류나 핵심 결정 추출이 없음.

**변경 사항**:
- `SUMMARIZER_PROMPT` 개선:
  - 각 프로젝트 요약에 작업 유형 태그 포함 (`#bugfix`, `#feature`, `#refactor`, `#investigation`, `#ops`, `#docs`)
  - tool use 데이터 (편집 파일, 실행 명령)를 입력에 포함하여 더 정확한 요약
  - 핵심 결정(decision)이 있으면 별도로 추출하도록 프롬프트 구성
- LLM 응답 파싱 개선 — 태그, 결정 블록을 구조화된 데이터로 변환
- Obsidian callout 형태로 결정 기록:
  ```markdown
  > [!decision] httpOnly 쿠키로 전환
  > localStorage 대신 httpOnly 쿠키 선택. 이유: XSS 공격 벡터 제거.
  ```

**파일**: `src/summarizer/index.ts`, `src/obsidian/writer.ts`

### 예상 결과물

개선 전:
```markdown
# 2026-03-24

## Summary
**[luffy]**
- 에이전트 라우터 리팩토링
- PR 병합
```

개선 후:
```markdown
---
date: 2026-03-24
projects: ["[[luffy]]", "[[agent-human-log]]"]
commits: 12
sessions: 5
hours: 4.5
files-edited: [src/router/agent.ts, src/middleware/auth.ts]
work-types: [refactor, bugfix]
---

# 2026-03-24

## Summary

**[[luffy]]** `#refactor` `#bugfix`
- 에이전트 라우터를 5개 도메인 모듈로 분리, PR 3개 병합
- auth 미들웨어에서 세션 토큰을 httpOnly 쿠키로 전환하여 XSS 취약점 해소
- 편집: `src/router/agent.ts`, `src/middleware/auth.ts` 외 8개 파일

> [!decision] 라우터 분리 전략
> 도메인별 분리 선택 (기능별 분리 대신). 이유: 각 도메인팀이 독립 배포 가능.

**[[agent-human-log]]** `#feature`
- Phase 2 로드맵 작성 및 의도 추출 강화 구현 시작
```

---

## PR #6 — Carry Forward 복원 + 크로스데이 컨텍스트

> 핵심: "어제 뭐 했지?"를 넘어 "뭐가 아직 안 끝났지?"를 추적.
> 현재 완전히 죽어있는 carry forward를 실제로 동작하게 만든다.

### 6-A. OpenCode todo 테이블 연동

**문제**: OpenCode DB에 `todo` 테이블이 있지만 전혀 사용 안 됨. `completedTodos`는 항상 빈 배열.

**변경 사항**:
- `src/analyzers/opencode.ts` — `todo` 테이블 쿼리 추가
  ```sql
  SELECT content, status, priority FROM todo
  WHERE session_id IN (오늘 세션 ID들)
  ORDER BY priority ASC, position ASC
  ```
- `SessionEntry.completedTodos` → 완료된 todo 항목 채우기
- 새 필드: `SessionEntry.pendingTodos: string[]` — 미완료 항목
- carry forward에 pending todos 자동 포함

**파일**: `src/analyzers/opencode.ts`, `src/types/index.ts`

### 6-B. Carry forward 추출 로직 개선

**문제**: `extractCarryForward()`가 빈 배열에서 "todo"/"pending" 키워드만 찾음. 사실상 아무것도 안 함.

**변경 사항**:
- 미완료 todo 항목 (6-A에서 추출) 포함
- LLM에게 carry forward 항목도 함께 추출하도록 프롬프트 확장
  - "세션에서 명시적으로 '내일', '나중에', '다음에' 등으로 미룬 작업"
  - "시작했지만 완료하지 못한 것으로 보이는 작업"
- git: merge 안 된 활성 브랜치 목록을 carry forward에 포함
- Obsidian에서 체크박스(`- [ ]`)로 렌더링, 완료 시 수동 체크 가능

**파일**: `src/summarizer/index.ts`, `src/analyzers/git.ts`

### 6-C. 어제 → 오늘 자동 이월

**문제**: `get_yesterday`가 텍스트만 반환. carry forward 항목이 오늘 노트에 자동 반영되지 않음.

**변경 사항**:
- `daily_summary` 실행 시 전날 노트의 미체크된 carry forward 항목을 자동 수집
- 오늘 노트의 Carry Forward 섹션에 이월 항목 포함 (출처 날짜 표시)
  ```markdown
  ## Carry Forward
  - [ ] auth 미들웨어 CSRF 토큰 추가 (from 03-23)
  - [ ] luffy 에이전트 온보딩 테스트 작성 (from 03-22)
  - [ ] 오늘 새로 발생한 미완료 작업
  ```
- 3일 이상 이월된 항목은 `⚠️` 표시로 주의 환기
- 완료 감지: git commit이나 세션에서 해당 작업이 완료된 것으로 보이면 자동 체크

**파일**: `src/obsidian/writer.ts`, `src/summarizer/index.ts`, `src/mcp-server/index.ts`

---

## PR #7 — 주간 요약 + 시계열 인사이트

> 핵심: 일일 노트를 넘어 주간/월간 패턴을 보여주는 상위 뷰.
> Obsidian Dataview와 연계하여 볼트 내에서 직접 쿼리 가능.

### 7-A. 주간 요약 자동 생성

**변경 사항**:
- 새 CLI 명령: `ahl weekly [--week YYYY-Wnn]`
- 새 MCP 도구: `weekly_summary`
- 해당 주의 일일 노트 7개를 읽어서 LLM으로 주간 요약 생성
- 출력 포맷:
  ```markdown
  ---
  date-range: [2026-03-18, 2026-03-24]
  type: weekly-log
  week: 2026-W13
  projects: ["[[luffy]]", "[[agent-human-log]]"]
  total-commits: 55
  total-hours: 28
  ---

  # Week 13 (2026-03-18 ~ 2026-03-24)

  ## 이번 주 핵심
  - [[luffy]]: 에이전트 온보딩 플로우 완성, 라우터 리팩토링
  - [[agent-human-log]]: Phase 1 MVP → Phase 2 전환

  ## 프로젝트별 시간 분배
  - [[luffy]]: 65% (~18h)
  - [[agent-human-log]]: 35% (~10h)

  ## 주요 결정
  - 라우터를 도메인별로 분리 (기능별 대신)
  - auth를 httpOnly 쿠키로 전환

  ## 다음 주 이월
  - [ ] CSRF 토큰 구현
  - [ ] 에이전트 온보딩 E2E 테스트
  ```
- Obsidian에서 `Weekly Notes/` 디렉토리에 저장

**파일**: `src/cli/weekly-summary.ts` (신규), `src/summarizer/index.ts`, `src/obsidian/writer.ts`, `src/mcp-server/index.ts`

### 7-B. Dataview 연동 가이드 + 템플릿

**변경 사항**:
- `docs/obsidian-setup.md` — Dataview 쿼리 예시 제공:
  ```dataview
  TABLE commits, hours, work-types
  FROM "Daily Notes"
  WHERE type = "daily-log"
  SORT date DESC
  LIMIT 14
  ```
  ```dataview
  TABLE date, summary
  FROM "Daily Notes"
  WHERE contains(projects, "[[luffy]]")
  SORT date DESC
  ```
- 프로젝트별 노트 템플릿 (선택적 — 프로젝트 허브 페이지)
- Obsidian 볼트 초기 설정 안내 (Daily Notes 플러그인 설정, Dataview 설치)

**파일**: `docs/obsidian-setup.md` (신규)

---

## PR #8 — 메모리 스토어 + 추천 엔진

> 핵심: Obsidian은 사람이 읽는 뷰, SQLite는 에이전트가 읽는 뷰.
> 과거 데이터를 구조화하여 "오늘 뭘 해야 하지?"에 답하는 추천 기능.

### 8-A. 로컬 SQLite 메모리 스토어

**변경 사항**:
- `src/memory/store.ts` (신규) — 일일 요약을 SQLite에 영속화
  ```sql
  CREATE TABLE daily_summary (
    date TEXT PRIMARY KEY,
    projects TEXT,        -- JSON array
    summary TEXT,         -- 요약 텍스트
    carry_forward TEXT,   -- JSON array
    stats TEXT,
    work_types TEXT,      -- JSON array
    files_edited TEXT,    -- JSON array
    decisions TEXT,       -- JSON array
    created_at TEXT
  );

  CREATE TABLE carry_item (
    id INTEGER PRIMARY KEY,
    content TEXT,
    origin_date TEXT,
    status TEXT DEFAULT 'open',  -- open, done, dropped
    resolved_date TEXT,
    project TEXT
  );
  ```
- `daily_summary` 실행 시 Obsidian 기록과 동시에 SQLite에도 저장
- 과거 N일 데이터 조회 API 제공

**파일**: `src/memory/store.ts` (신규), `src/summarizer/index.ts`, `src/mcp-server/index.ts`

### 8-B. set_focus + get_recommendations MCP 도구

**변경 사항**:
- `set_focus` 도구: 아침에 오늘의 초점 설정 (30초, 선택적)
  - Obsidian Focus 섹션에 기록
  - SQLite에도 저장
- `get_recommendations` 도구: 과거 데이터 기반 오늘 우선순위 추천
  - 미완료 carry forward 항목 (오래된 것 우선)
  - 최근 집중한 프로젝트의 다음 단계
  - 반복 패턴 감지 (매주 월요일 특정 작업 등)
- Morning brief 형태로 제공:
  ```
  ## 오늘 추천
  1. ⚠️ CSRF 토큰 구현 (3일째 이월 중)
  2. luffy 에이전트 온보딩 E2E 테스트 (어제 시작, 미완료)
  3. agent-human-log PR #6 리뷰
  ```

**파일**: `src/mcp-server/index.ts`, `src/memory/store.ts`

---

## PR #9 — 세션 흐름 분석 + 생산성 패턴

> 핵심: 도구 호출 패턴에서 작업 흐름을 자동 분류하고,
> 시간대별/프로젝트별 생산성 패턴을 Obsidian에서 시각화.

### 9-A. 도구 패턴 기반 작업 흐름 분류

**변경 사항**:
- 세션 내 도구 호출 시퀀스에서 작업 흐름 자동 분류:
  - `Read → Grep → Read` = **investigation** (코드 조사)
  - `Read → Edit → Bash(test)` = **implementation** (구현 + 검증)
  - `Read → Edit → Edit → Edit` = **refactoring** (연속 수정)
  - `Bash(git) → Bash(gh)` = **ops** (운영/배포)
- 세션별 흐름 요약: "조사 30% → 구현 50% → 검증 20%"
- 일일 노트에 흐름 비율 포함

**파일**: `src/analyzers/flow.ts` (신규), `src/types/index.ts`

### 9-B. Obsidian 시각화 지원

**변경 사항**:
- frontmatter에 시각화용 데이터 추가:
  ```yaml
  flow-distribution:
    investigation: 30
    implementation: 50
    verification: 20
  time-blocks:
    - start: "09:00"
      end: "12:30"
      project: luffy
    - start: "14:00"
      end: "17:00"
      project: agent-human-log
  ```
- Dataview + Charts 플러그인 활용 가이드 추가
- 월간 리포트 생성 (`ahl monthly`)

**파일**: `src/obsidian/writer.ts`, `src/cli/monthly-summary.ts` (신규)

---

## 우선순위 요약

```
PR #5 — 의도 추출 강화 + Obsidian 메타데이터    ★★★ 최우선
  → 요약 품질이 근본적으로 올라감. 모든 후속 작업의 기반.

PR #6 — Carry Forward 복원 + 크로스데이           ★★★ 높음
  → 현재 죽어있는 기능을 살림. 일일 사용 가치 크게 증가.

PR #7 — 주간 요약 + Dataview 연동                ★★☆ 중간
  → 일일 → 주간 뷰 확장. Obsidian 활용도 극대화.

PR #8 — 메모리 스토어 + 추천                     ★★☆ 중간
  → "오늘 뭘 해야 하지?" 에 답하는 기능. Phase 2 핵심.

PR #9 — 세션 흐름 분석 + 생산성 패턴              ★☆☆ 후순위
  → 흥미롭지만 핵심 가치 대비 복잡도가 높음. 앞선 PR들이 안정된 후.
```

## 주의사항

- 각 PR은 에이전트가 한 번에 구현할 수 있는 규모로 설계됨
- PR 간 의존성: #5 → #6 → #7 → #8 → #9 (순차적)
- #5가 가장 중요 — 여기서 추출한 데이터가 이후 모든 기능의 입력
- Obsidian 볼트 구조 변경 시 기존 노트 호환성 유지 (마이그레이션 로직 포함)
- LLM 호출 비용 제어: 입력 토큰 예산을 항상 명시적으로 관리
