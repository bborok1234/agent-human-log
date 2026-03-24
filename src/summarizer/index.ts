import Anthropic from '@anthropic-ai/sdk';
import type { DayData, DailySummary, DecisionRecord, SummarizerConfig } from '../types/index.js';

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
  /^<system-reminder>/,
  /^<session-restore>/,
  /^<user-prompt-submit-hook>/,
  /^\[OMC/,
];

const MODE_PREFIX_PATTERN = /^\[(analyze-mode|search-mode|implement-mode|review-mode)\]\s*/i;

const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_CHARS = 300;
const MAX_TOTAL_MESSAGE_CHARS = 4000;

/** Low-value noise patterns: confirmations, slash commands, short reactions */
const NOISE_PATTERNS = [
  /^(ㅇㅋ|ㅇㅇ|ㄱㄱ|ㅎㅎ|ㄴㄴ|ok|okay|yes|y|no|n|sure|good|nice|great|thx|thanks|감사|네|응|ㅇ|고고|오케이|좋아|맞아|됐어|해줘|진행해|시작해|계속|커밋|머지)$/i,
  /^\//,  // slash commands
  /^![\s\S]{0,20}$/,  // short shell commands (! prefix)
  /^(git |npm |cd |ls )/,  // raw terminal commands pasted
  /^<tool_result>/,
  /^\[Request interrupted/,
  /^Human:/,
];

function isNoiseMessage(msg: string): boolean {
  const trimmed = msg.trim();
  if (trimmed.length < MIN_MESSAGE_LENGTH) return true;
  return NOISE_PATTERNS.some((p) => p.test(trimmed));
}

function isSystemMessage(msg: string): boolean {
  const firstLine = msg.split('\n')[0].trim();
  if (firstLine.length < MIN_MESSAGE_LENGTH) return true;
  if (SYSTEM_MESSAGE_PATTERNS.some((p) => p.test(firstLine))) return true;
  return isNoiseMessage(firstLine);
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

/** Normalize project name to last meaningful segment (e.g., "searchright/luffy" → "luffy") */
function normalizeProjectName(name: string): string {
  const segments = name.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? name;
}

/** Truncate a message to MAX_MESSAGE_CHARS, preserving whole words */
function truncateMessage(msg: string): string {
  if (msg.length <= MAX_MESSAGE_CHARS) return msg;
  const truncated = msg.slice(0, MAX_MESSAGE_CHARS);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > MAX_MESSAGE_CHARS * 0.8 ? truncated.slice(0, lastSpace) : truncated) + '...';
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
  const hours = Math.round((totalMinutes / 60) * 10) / 10;

  // Collect unique projects (normalize: take last path segment as canonical name)
  const rawProjects = [
    ...sessions.map((s) => s.project),
    ...git.map((g) => g.repo),
  ];
  const projects = [...new Set(rawProjects.map(normalizeProjectName))];

  // Build per-project stats
  const projectStats = buildProjectStats(sessions, git);
  const statsLines = [
    `총 ${totalCommits} commits · ${totalFiles} files · +${totalInsertions}/-${totalDeletions} · ${totalSessions} sessions · ~${hours}h`,
  ];
  for (const [proj, ps] of Object.entries(projectStats)) {
    const parts: string[] = [];
    if (ps.commits > 0) parts.push(`${ps.commits} commits`);
    if (ps.filesChanged > 0) parts.push(`${ps.filesChanged} files · +${ps.insertions}/-${ps.deletions}`);
    if (ps.sessions > 0) parts.push(`${ps.sessions} sessions · ~${ps.hours}h`);
    if (parts.length > 0) statsLines.push(`${proj}: ${parts.join(' · ')}`);
  }
  const stats = statsLines.join('\n');

  const cleanedMessages = extractCleanMessages(sessions);
  const commitMessages = git.flatMap((g) =>
    g.commits.map((c) => `[${normalizeProjectName(g.repo)}] ${c.message}`),
  );
  const toolContext = buildToolContext(sessions);

  let summary: string[] = [];
  let workTypes: string[] = [];
  let decisions: DecisionRecord[] = [];
  const llmCarryForward: string[] = [];

  if (config && (cleanedMessages.length > 0 || commitMessages.length > 0)) {
    // Summarize per-project to guarantee grouped output
    const grouped = groupByProject(cleanedMessages, commitMessages, toolContext);

    for (const [project, data] of Object.entries(grouped)) {
      const result = await llmSummarizeProject(project, data, date, config);
      // Add project header
      const tagStr = result.workTypes.length > 0 ? ' ' + result.workTypes.map((t) => `#${t}`).join(' ') : '';
      summary.push(`\n**[[${project}]]**${tagStr}`);
      summary.push(...result.summary);
      workTypes.push(...result.workTypes);
      decisions.push(...result.decisions);
      llmCarryForward.push(...result.carryForward);
    }
    workTypes = [...new Set(workTypes)];
  } else {
    summary = fallbackSummarize(cleanedMessages);
  }

  // Merge carry forward: LLM-extracted + static (pending todos + active branches)
  const staticCarry = extractCarryForward(sessions, git);
  const carrySet = new Set<string>();
  const carryForward: string[] = [];
  for (const item of [...llmCarryForward, ...staticCarry]) {
    const key = item.toLowerCase().trim();
    if (!carrySet.has(key)) {
      carrySet.add(key);
      carryForward.push(item);
    }
  }

  return {
    date,
    summary,
    carryForward,
    stats,
    projects,
    workTypes,
    decisions,
    filesEdited: [],
    hours,
    commits: totalCommits,
    sessions: totalSessions,
  };
}

interface ProjectInput {
  messages: string[];
  commits: string[];
  tools: string[];
}

/** Group tagged messages by project name */
function groupByProject(
  userMessages: string[],
  commitMessages: string[],
  toolContext: string[],
): Record<string, ProjectInput> {
  const data: Record<string, ProjectInput> = {};

  const ensure = (proj: string): ProjectInput => {
    if (!data[proj]) data[proj] = { messages: [], commits: [], tools: [] };
    return data[proj];
  };

  const extractProject = (msg: string): [string, string] => {
    const match = msg.match(/^\[([^\]]+)\]\s*/);
    return match ? [match[1], msg.slice(match[0].length)] : ['other', msg];
  };

  for (const msg of userMessages) {
    const [proj, content] = extractProject(msg);
    ensure(proj).messages.push(content);
  }
  for (const msg of commitMessages) {
    const [proj, content] = extractProject(msg);
    ensure(proj).commits.push(content);
  }
  for (const msg of toolContext) {
    const [proj, content] = extractProject(msg);
    ensure(proj).tools.push(content);
  }

  return data;
}

interface LlmResult {
  summary: string[];
  workTypes: string[];
  decisions: DecisionRecord[];
  carryForward: string[];
}

async function llmSummarizeProject(
  project: string,
  data: ProjectInput,
  date: string,
  config: SummarizerConfig,
): Promise<LlmResult> {
  try {
    const client = new Anthropic();

    const inputLines = [`Date: ${date}`, `Project: ${project}`, ''];

    if (data.messages.length > 0) {
      inputLines.push('Developer intent (why):', ...data.messages.map((m) => `- ${m}`), '');
    }
    if (data.commits.length > 0) {
      inputLines.push('Git commits (what shipped):', ...data.commits.map((m) => `- ${m}`), '');
    }
    if (data.tools.length > 0) {
      inputLines.push('Tool activity:', ...data.tools.map((m) => `- ${m}`), '');
    }

    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      messages: [
        {
          role: 'user',
          content: inputLines.join('\n'),
        },
      ],
      system: PROJECT_SUMMARIZER_PROMPT,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return parseLlmResponse(text);
  } catch (error) {
    console.error('LLM summarization failed, falling back to extraction:', error);
    return { summary: fallbackSummarize(data.messages), workTypes: [], decisions: [], carryForward: [] };
  }
}

function parseLlmResponse(text: string): LlmResult {
  const summary: string[] = [];
  const workTypes = new Set<string>();
  const decisions: DecisionRecord[] = [];
  const carryForward: string[] = [];

  // Try to extract JSON block first
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.decisions && Array.isArray(parsed.decisions)) {
        for (const d of parsed.decisions) {
          if (d.title && d.rationale) {
            decisions.push({
              title: d.title,
              rationale: d.rationale,
              tradeoff: d.tradeoff,
            });
          }
        }
      }
      if (parsed.workTypes && Array.isArray(parsed.workTypes)) {
        for (const t of parsed.workTypes) workTypes.add(t);
      }
    } catch {
      // JSON parsing failed, continue with text parsing
    }
  }

  // Parse the text portion (remove JSON block and any fenced code blocks)
  const textPortion = text
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();
  const lines = textPortion.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  let inCodeFence = false;
  for (const line of lines) {
    // Skip any remaining code fence content
    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    // Skip JSON-like lines that leaked through
    if (/^[{}\[\]"]/.test(line) || line.startsWith('//')) continue;

    // Extract work type tags inline
    const tagMatches = line.match(/#(bugfix|feature|refactor|investigation|ops|docs|perf)/g);
    if (tagMatches) {
      for (const tag of tagMatches) workTypes.add(tag.slice(1));
    }

    // Skip project headers — we add them externally
    if (/^\[[\w/.-]+\]/.test(line) && !line.startsWith('[-')) continue;

    // Carry forward lines (CF: prefix)
    if (/^CF:\s*/i.test(line)) {
      carryForward.push(line.replace(/^CF:\s*/i, '').trim());
      continue;
    }

    // Accept various bullet styles: -, •, *, and normalize to -
    if (/^[-•*]\s/.test(line)) {
      summary.push(line.replace(/^[•*]\s/, '- '));
    }
  }

  return { summary, workTypes: [...workTypes], decisions, carryForward };
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
  const messages: string[] = [];
  let totalChars = 0;

  for (const s of sessions) {
    for (const raw of s.userMessages) {
      if (totalChars >= MAX_TOTAL_MESSAGE_CHARS) break;

      const cleaned = cleanUserMessage(raw);
      if (cleaned.length < MIN_MESSAGE_LENGTH || isSystemMessage(cleaned)) continue;

      const truncated = truncateMessage(cleaned);
      const tagged = `[${normalizeProjectName(s.project)}] ${truncated}`;
      messages.push(tagged);
      totalChars += tagged.length;
    }
  }

  return messages;
}

interface ProjectStat {
  commits: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
  sessions: number;
  hours: number;
}

function buildProjectStats(sessions: DayData['sessions'], git: DayData['git']): Record<string, ProjectStat> {
  const stats: Record<string, ProjectStat> = {};

  const ensure = (name: string): ProjectStat => {
    if (!stats[name]) stats[name] = { commits: 0, filesChanged: 0, insertions: 0, deletions: 0, sessions: 0, hours: 0 };
    return stats[name];
  };

  for (const s of sessions) {
    const ps = ensure(normalizeProjectName(s.project));
    ps.sessions += 1;
    ps.hours = Math.round((ps.hours + s.durationMinutes / 60) * 10) / 10;
  }

  for (const g of git) {
    const ps = ensure(normalizeProjectName(g.repo));
    ps.commits += g.commits.length;
    ps.filesChanged += g.totalFilesChanged;
    ps.insertions += g.totalInsertions;
    ps.deletions += g.totalDeletions;
  }

  return stats;
}

/** Build tool activity context lines for LLM input */
function buildToolContext(sessions: DayData['sessions']): string[] {
  const lines: string[] = [];

  for (const s of sessions) {
    const parts: string[] = [];

    if (s.filesEdited.length > 0) {
      const files = s.filesEdited.slice(0, 10); // cap at 10 files
      parts.push(`edited: ${files.join(', ')}${s.filesEdited.length > 10 ? ` (+${s.filesEdited.length - 10} more)` : ''}`);
    }

    if (s.commandsRun.length > 0) {
      const cmds = s.commandsRun.slice(0, 5);
      parts.push(`ran: ${cmds.join('; ')}`);
    }

    if (Object.keys(s.toolUseCounts).length > 0) {
      const top = Object.entries(s.toolUseCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([tool, count]) => `${tool}(${count})`)
        .join(', ');
      parts.push(`tools: ${top}`);
    }

    if (parts.length > 0) {
      lines.push(`[${normalizeProjectName(s.project)}] ${parts.join(' | ')}`);
    }
  }

  return lines;
}

function extractCarryForward(
  sessions: DayData['sessions'],
  git: DayData['git'],
): string[] {
  const items: string[] = [];
  const seen = new Set<string>();

  const addUnique = (item: string) => {
    const key = item.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  };

  // 1. Pending/in-progress todos from OpenCode
  for (const session of sessions) {
    for (const todo of session.pendingTodos) {
      addUnique(todo);
    }
  }

  return items.slice(0, 10);
}

const PROJECT_SUMMARIZER_PROMPT = `You are a work journal assistant. Given ONE project's data from a developer's day, produce a concise summary.

## Rules
- 3-5 bullet points summarizing what was SHIPPED or DECIDED
- Each bullet describes an OUTCOME, not a process
- Git commits = strongest signal (what shipped). Developer intent = why context.
- Write in the same language the developer used (Korean if input is Korean)
- No preamble, no project header — start directly with bullet points

## After the summary bullets, add these sections in order:

### CARRY FORWARD section (things to check tomorrow):
Write lines starting with "CF:" — one per item. Extract from context:
- Work explicitly deferred ("내일", "나중에", "다음에")
- Started but not completed tasks
- Issues discovered but not yet fixed (bugs, glitches, edge cases)
- Pending reviews, merges, or deployments
Write actionable items, not branch names. Skip this section entirely if everything was completed.

### JSON metadata block:
\`\`\`json
{
  "workTypes": ["feature", "bugfix", "refactor", "investigation", "ops", "docs", "perf"],
  "decisions": [
    { "title": "...", "rationale": "...", "tradeoff": "..." }
  ]
}
\`\`\`
Only include work types that actually apply. Only include decisions if a genuine choice was made.

## Good bullets:
- PR-PERF 완성 — 배치 사이즈 50→100명 튜닝, 라운드 정렬로 성능 최적화
- auth 미들웨어에서 세션 토큰을 httpOnly 쿠키로 전환하여 XSS 취약점 해소
- Phase 1 MVP 완성 — 세션 분석기 + Obsidian daily note 연동

## Good carry forward examples:
CF: SSE UI 글리치 원인 파악 필요 — 태그매칭 중 프론트엔드 중단 현상
CF: 100명 이상 배치 테스트 미검증 — 프로덕션 배포 전 확인 필요
CF: CSRF 토큰 구현 — httpOnly 전환 후 남은 보안 작업

## Bad bullets (DO NOT write like this):
- 라우터를 분리해야 하는지 논의함 (process, not outcome)
- 머지 완료 다음작업 진행 (noise)
- 커밋하고 push함 (mechanical action)`;
