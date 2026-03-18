import type { DayData, DailySummary } from '../types/index.js';

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

export async function summarizeDay(data: DayData): Promise<DailySummary> {
  const { date, sessions, git } = data;

  const totalCommits = git.reduce((sum, g) => sum + g.commits.length, 0);
  const totalFiles = git.reduce((sum, g) => sum + g.totalFilesChanged, 0);
  const totalInsertions = git.reduce((sum, g) => sum + g.totalInsertions, 0);
  const totalDeletions = git.reduce((sum, g) => sum + g.totalDeletions, 0);
  const totalSessions = sessions.length;
  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
  const hours = Math.round(totalMinutes / 60);

  const stats = `${totalCommits} commits · ${totalFiles} files · +${totalInsertions}/-${totalDeletions} · ${totalSessions} sessions · ~${hours}h`;

  // Phase 1 MVP: extract user messages as-is (human's own words)
  // Phase 1.5: LLM compression of user messages into 3-5 lines
  const summary = extractKeyMessages(sessions);

  const carryForward = extractCarryForward(sessions, git);

  return { date, summary, carryForward, stats };
}

function extractKeyMessages(
  sessions: DayData['sessions'],
): string[] {
  const allUserMessages = sessions.flatMap((s) =>
    s.userMessages
      .map(cleanUserMessage)
      .filter((msg) => msg.length >= MIN_MESSAGE_LENGTH && !isSystemMessage(msg))
      .map((msg) => ({
        project: s.project,
        message: msg,
      })),
  );

  const condensed = allUserMessages
    .map((m) => {
      const firstLine = m.message.split('\n')[0].trim();
      const truncated =
        firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
      return `[${m.project}] ${truncated}`;
    })
    .slice(0, 10);

  return condensed;
}

function extractCarryForward(
  sessions: DayData['sessions'],
  git: DayData['git'],
): string[] {
  const items: string[] = [];

  for (const g of git) {
    for (const branch of g.activeBranches) {
      if (branch !== 'main' && branch !== 'master') {
        items.push(`Open branch: ${g.repo}/${branch}`);
      }
    }
  }

  for (const session of sessions) {
    for (const todo of session.completedTodos) {
      if (todo.toLowerCase().includes('todo') || todo.toLowerCase().includes('pending')) {
        items.push(todo);
      }
    }
  }

  return items.slice(0, 5);
}
