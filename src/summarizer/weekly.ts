import Anthropic from '@anthropic-ai/sdk';
import type { ObsidianConfig, SummarizerConfig } from '../types/index.js';
import { readDailyNote, extractSection, SECTION_MARKERS } from '../obsidian/writer.js';

export interface WeeklySummary {
  week: string;            // e.g., "2026-W13"
  dateRange: [string, string]; // [start, end] YYYY-MM-DD
  projects: string[];
  totalCommits: number;
  totalHours: number;
  totalSessions: number;
  workTypes: string[];
  highlights: string[];    // LLM-generated weekly highlights
  decisions: string[];     // aggregated from daily notes
  carryForward: string[];  // unchecked items from last day
  projectBreakdown: Record<string, { hours: number; commits: number }>;
  stats: string;
}

interface DailyData {
  date: string;
  summary: string[];
  decisions: string[];
  carryForward: string[];
  frontmatter: Record<string, unknown>;
}

/** Get ISO week number and year */
function getWeekInfo(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** Get Monday-Sunday date range for a given date's week */
function getWeekRange(dateStr: string): [string, string] {
  const date = new Date(`${dateStr}T12:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return [monday.toLocaleDateString('en-CA'), sunday.toLocaleDateString('en-CA')];
}

/** Get all dates (YYYY-MM-DD) in a week */
function getWeekDates(startDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${startDate}T12:00:00`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toLocaleDateString('en-CA'));
  }
  return dates;
}

/** Parse YAML frontmatter from a note */
function parseFrontmatter(note: string): Record<string, unknown> {
  if (!note.startsWith('---')) return {};
  const endIdx = note.indexOf('---', 3);
  if (endIdx === -1) return {};

  const yaml = note.slice(3, endIdx).trim();
  const result: Record<string, unknown> = {};

  let currentKey = '';
  let arrayValues: string[] = [];
  let inArray = false;

  for (const line of yaml.split('\n')) {
    const arrayItem = line.match(/^\s+-\s+"?(.+?)"?$/);
    if (arrayItem && inArray) {
      arrayValues.push(arrayItem[1].replace(/^\[\[|\]\]$/g, ''));
      continue;
    }

    if (inArray) {
      result[currentKey] = arrayValues;
      inArray = false;
      arrayValues = [];
    }

    const kv = line.match(/^(\S+):\s*(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      if (value === '') {
        currentKey = key;
        inArray = true;
        arrayValues = [];
      } else {
        result[key] = isNaN(Number(value)) ? value : Number(value);
      }
    }
  }

  if (inArray) {
    result[currentKey] = arrayValues;
  }

  return result;
}

/** Read and parse a daily note into structured data */
async function readDailyData(
  config: ObsidianConfig,
  date: string,
): Promise<DailyData | null> {
  const note = await readDailyNote(config, date);
  if (!note) return null;

  const frontmatter = parseFrontmatter(note);
  const summary = extractSection(note, SECTION_MARKERS.summary);
  const carryForward = extractSection(note, '## Carry Forward');
  const decisionLines = extractSection(note, '## Decisions');

  return {
    date,
    summary,
    decisions: decisionLines.filter((l) => l.startsWith('>')),
    carryForward: carryForward.filter((l) => l.startsWith('- [ ]')),
    frontmatter,
  };
}

/** Aggregate daily data into a weekly summary */
export async function summarizeWeek(
  obsidianConfig: ObsidianConfig,
  summarizerConfig: SummarizerConfig | undefined,
  targetDate?: string,
): Promise<WeeklySummary> {
  const refDate = targetDate ?? new Date().toLocaleDateString('en-CA');
  const [weekStart, weekEnd] = getWeekRange(refDate);
  const weekDates = getWeekDates(weekStart);
  const { year, week } = getWeekInfo(new Date(`${refDate}T12:00:00`));
  const weekLabel = `${year}-W${String(week).padStart(2, '0')}`;

  // Read all daily notes for the week
  const dailyData: DailyData[] = [];
  for (const date of weekDates) {
    const data = await readDailyData(obsidianConfig, date);
    if (data) dailyData.push(data);
  }

  // Aggregate stats
  let totalCommits = 0;
  let totalHours = 0;
  let totalSessions = 0;
  const allProjects = new Set<string>();
  const allWorkTypes = new Set<string>();
  const projectBreakdown: Record<string, { hours: number; commits: number }> = {};

  for (const day of dailyData) {
    const fm = day.frontmatter;
    totalCommits += (fm.commits as number) || 0;
    totalHours += (fm.hours as number) || 0;
    totalSessions += (fm.sessions as number) || 0;

    const projects = fm.projects as string[] | undefined;
    if (projects) {
      for (const p of projects) {
        const clean = p.replace(/^\[\[|\]\]$/g, '');
        allProjects.add(clean);
        if (!projectBreakdown[clean]) projectBreakdown[clean] = { hours: 0, commits: 0 };
      }
    }

    const wt = fm['work-types'] as string[] | undefined;
    if (wt) {
      for (const t of wt) allWorkTypes.add(t);
    }
  }

  // Parse per-project stats from Stats sections
  for (const day of dailyData) {
    const statsLines = extractSection(day.frontmatter['_raw'] as string ?? '', '## Stats');
    // Also try from the summary sections
    const note = await readDailyNote(obsidianConfig, day.date);
    if (note) {
      const stats = extractSection(note, SECTION_MARKERS.stats);
      for (const line of stats) {
        const match = line.match(/^(\S+):\s*(\d+)\s*commits.*?(\d+(?:\.\d+)?)h$/);
        if (match) {
          const [, proj, commits, hours] = match;
          if (!projectBreakdown[proj]) projectBreakdown[proj] = { hours: 0, commits: 0 };
          projectBreakdown[proj].hours += parseFloat(hours);
          projectBreakdown[proj].commits += parseInt(commits, 10);
        }
      }
    }
  }

  // Collect all summaries and decisions
  const allSummaries = dailyData.map((d) => `### ${d.date}\n${d.summary.join('\n')}`);
  const allDecisions = dailyData.flatMap((d) => d.decisions);

  // Last day's unchecked carry forward
  const lastDay = dailyData[dailyData.length - 1];
  const carryForward = lastDay?.carryForward.map((l) => l.replace(/^- \[ \]\s*/, '')) ?? [];

  // LLM weekly highlights
  let highlights: string[] = [];
  if (summarizerConfig && allSummaries.length > 0) {
    highlights = await llmWeeklySummary(allSummaries, summarizerConfig);
  } else {
    highlights = dailyData.flatMap((d) => d.summary.slice(0, 2));
  }

  totalHours = Math.round(totalHours * 10) / 10;

  const stats = `${dailyData.length}일 · ${totalCommits} commits · ${totalSessions} sessions · ~${totalHours}h`;

  return {
    week: weekLabel,
    dateRange: [weekStart, weekEnd],
    projects: [...allProjects],
    totalCommits,
    totalHours,
    totalSessions,
    workTypes: [...allWorkTypes],
    highlights,
    decisions: allDecisions,
    carryForward,
    projectBreakdown,
    stats,
  };
}

async function llmWeeklySummary(
  dailySummaries: string[],
  config: SummarizerConfig,
): Promise<string[]> {
  try {
    const client = new Anthropic();

    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      messages: [
        {
          role: 'user',
          content: dailySummaries.join('\n\n'),
        },
      ],
      system: WEEKLY_PROMPT,
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.replace(/^[•*]\s/, '- '))
      .filter((l) => /^[-#]/.test(l) || l.startsWith('**'));
  } catch (error) {
    console.error('Weekly LLM summarization failed:', error);
    return ['- 주간 요약 생성 실패'];
  }
}

const WEEKLY_PROMPT = `You are a work journal assistant. Given a week of daily summaries, produce a weekly overview.

## Rules
- 프로젝트별로 이번 주 핵심 성과 3-5줄로 요약
- 각 프로젝트 헤더를 **[[project-name]]** 형태로
- 일별 세부사항이 아닌 주간 단위의 큰 그림 (e.g., "PR-PERF/TOOL-OPT/AUTH 3개 PR 완성으로 성능 최적화 마무리")
- 개발자가 사용한 언어(한국어)로 작성
- No preamble — 바로 프로젝트 헤더로 시작

## Example
**[[luffy]]**
- 성능 최적화 3개 PR 완성 (배치 튜닝 + 도구 최적화 + 인증 강화)
- 82명 규모 E2E 검증 완료, 프로덕션 배포 준비 상태
- LLM 도구 개발 가이드라인 확립으로 향후 개발 표준 마련

**[[agent-human-log]]**
- Phase 1 MVP에서 Phase 2로 전환 — 의도 추출 + carry forward + Obsidian 연동
- 비용 최적화 (Haiku 전환)로 월 $0.6 수준 운영 가능`;
