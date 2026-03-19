import Anthropic from '@anthropic-ai/sdk';
import type { DayData, DailySummary, SummarizerConfig } from '../types/index.js';

const SYSTEM_MESSAGE_PATTERNS = [
  /^<local-command/,
  /^<command-name>/,
  /^<local-research/,
  /^Base directory for this skill:/,
  /^<system/,
  /^<context/,
  /^<\/?(local-command|command-name|local-research|system|context)/,
  /^<!-- OMO_INTERNAL/,
  /^\[SYSTEM DIRECTIVE/,
];

const MODE_PREFIX_PATTERN = /^\[(analyze-mode|search-mode|implement-mode|review-mode)\]\s*/i;

const MIN_MESSAGE_LENGTH = 5;

function isSystemMessage(msg: string): boolean {
  const firstLine = msg.split('\n')[0].trim();
  if (firstLine.length < MIN_MESSAGE_LENGTH) return true;
  return SYSTEM_MESSAGE_PATTERNS.some((p) => p.test(firstLine));
}

function cleanUserMessage(msg: string): string {
  const firstLine = msg.split('\n')[0].trim();

  if (MODE_PREFIX_PATTERN.test(firstLine)) {
    const separatorIdx = msg.indexOf('\n---\n');
    if (separatorIdx !== -1) {
      return msg.slice(separatorIdx + 5).trim();
    }
    return '';
  }

  return msg.trim();
}

export async function summarizeDay(
  data: DayData,
  config?: SummarizerConfig,
): Promise<DailySummary> {
  const { date, sessions, git } = data;

  const totalCommits = git.reduce((sum, g) => sum + g.commits.length, 0);
  const totalFiles = git.reduce((sum, g) => sum + g.totalFilesChanged, 0);
  const totalInsertions = git.reduce((sum, g) => sum + g.totalInsertions, 0);
  const totalDeletions = git.reduce((sum, g) => sum + g.totalDeletions, 0);
  const totalSessions = sessions.length;
  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
  const hours = Math.round(totalMinutes / 60);

  const stats = `${totalCommits} commits · ${totalFiles} files · +${totalInsertions}/-${totalDeletions} · ${totalSessions} sessions · ~${hours}h`;

  const cleanedMessages = extractCleanMessages(sessions);
  const commitMessages = git.flatMap((g) =>
    g.commits.map((c) => `[${g.repo}] ${c.message}`),
  );

  let summary: string[];
  if (config && cleanedMessages.length > 0) {
    summary = await llmSummarize(cleanedMessages, commitMessages, date, config);
  } else {
    summary = fallbackSummarize(cleanedMessages);
  }

  const carryForward = extractCarryForward(sessions, git);

  return { date, summary, carryForward, stats };
}

async function llmSummarize(
  userMessages: string[],
  commitMessages: string[],
  date: string,
  config: SummarizerConfig,
): Promise<string[]> {
  try {
    const client = new Anthropic();

    const inputBlock = [
      `Date: ${date}`,
      '',
      'User messages (developer intent):',
      ...userMessages.map((m, i) => `${i + 1}. ${m}`),
    ];

    if (commitMessages.length > 0) {
      inputBlock.push(
        '',
        'Git commits:',
        ...commitMessages.map((m) => `- ${m}`),
      );
    }

    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      messages: [
        {
          role: 'user',
          content: inputBlock.join('\n'),
        },
      ],
      system: SUMMARIZER_PROMPT,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        if (line.startsWith('[') && line.endsWith(']')) return `\n**${line}**`;
        return line.startsWith('-') ? line : `- ${line}`;
      });
  } catch (error) {
    console.error('LLM summarization failed, falling back to extraction:', error);
    return fallbackSummarize(userMessages);
  }
}

function fallbackSummarize(messages: string[]): string[] {
  return messages
    .map((m) => {
      const firstLine = m.split('\n')[0].trim();
      return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
    })
    .slice(0, 10);
}

function extractCleanMessages(sessions: DayData['sessions']): string[] {
  return sessions.flatMap((s) =>
    s.userMessages
      .map(cleanUserMessage)
      .filter((msg) => msg.length >= MIN_MESSAGE_LENGTH && !isSystemMessage(msg))
      .map((msg) => {
        const firstLine = msg.split('\n')[0].trim();
        const truncated = firstLine.length > 200 ? firstLine.slice(0, 200) + '...' : firstLine;
        return `[${s.project}] ${truncated}`;
      }),
  );
}

function extractCarryForward(
  sessions: DayData['sessions'],
  _git: DayData['git'],
): string[] {
  const items: string[] = [];

  for (const session of sessions) {
    for (const todo of session.completedTodos) {
      if (todo.toLowerCase().includes('todo') || todo.toLowerCase().includes('pending')) {
        items.push(todo);
      }
    }
  }

  return items.slice(0, 5);
}

const SUMMARIZER_PROMPT = `You are a work journal assistant. Given a developer's AI session messages and git commits from one day, produce a TL;DR summary grouped by project.

Format:
- Group by project. Each project header is "[project-name]" on its own line
- Under each project, 3-5 bullet points summarizing what was shipped/decided
- Each bullet describes an OUTCOME, not a process
- Git commits are the strongest signal — they show what was actually shipped
- User messages add "why" context — use them to enrich commit summaries
- Write in the same language the developer used (Korean if input is Korean)
- No preamble — start directly with the first project header

Good example:
[luffy]
- 에이전트 라우터를 5개 도메인 모듈로 분리 리팩토링, PR 3개 병합
- ROADMAP_V2가 929줄로 비대해져서 3개 파일로 분할 (로드맵/완료PR/결정사항)
- 에이전트 온보딩 메시지 + 추천 작업 버튼 기능 구현

[agent-human-log]
- Phase 1 MVP 완성 — 세션 분석기 + Obsidian daily note 연동 + LLM 요약
- OpenCode SQLite 세션 파서 추가하여 최근 작업 데이터 수집
- 로컬 실행 환경 구축 (npm run daily 한 줄 실행)

Bad:
- 라우터를 분리해야 하는지 논의함 (process, not outcome)
- 머지 완료 다음작업 진행 (noise)
- 커밋하고 push함 (mechanical action)`;
