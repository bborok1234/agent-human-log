import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { ObsidianConfig, DailySummary, DecisionRecord, TimeBlock } from '../types/index.js';

const SECTION_MARKERS = {
  focus: '## Focus',
  summary: '## Summary',
  workLog: '## Work Log',
  carryForward: '## Carry Forward',
  stats: '## Stats',
} as const;

function getDailyNotePath(config: ObsidianConfig, date: string): string {
  return join(config.vaultPath, config.dailyNotesDir, `${date}.md`);
}

// --- Frontmatter ---

function buildFrontmatter(summary: DailySummary): string {
  const lines = ['---'];
  lines.push(`date: ${summary.date}`);
  lines.push(`type: daily-log`);

  if (summary.projects.length > 0) {
    lines.push(`projects:`);
    for (const p of summary.projects) {
      lines.push(`  - "[[${p}]]"`);
    }
  }

  lines.push(`commits: ${summary.commits}`);
  lines.push(`sessions: ${summary.sessions}`);
  lines.push(`hours: ${summary.hours}`);

  if (summary.workTypes.length > 0) {
    lines.push(`work-types:`);
    for (const t of summary.workTypes) {
      lines.push(`  - ${t}`);
    }
  }

  if (Object.keys(summary.flowDistribution).length > 0) {
    lines.push(`flow-distribution:`);
    for (const [type, pct] of Object.entries(summary.flowDistribution)) {
      lines.push(`  ${type}: ${pct}`);
    }
  }

  if (summary.timeBlocks.length > 0) {
    lines.push(`time-blocks:`);
    for (const block of summary.timeBlocks) {
      lines.push(`  - start: "${block.start}"`);
      lines.push(`    end: "${block.end}"`);
      lines.push(`    project: ${block.project}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

function replaceFrontmatter(note: string, newFrontmatter: string): string {
  // If note starts with ---, replace existing frontmatter
  if (note.startsWith('---')) {
    const endIdx = note.indexOf('---', 3);
    if (endIdx !== -1) {
      const afterFrontmatter = note.slice(endIdx + 3);
      return newFrontmatter + afterFrontmatter;
    }
  }
  // No existing frontmatter — prepend it
  return newFrontmatter + '\n' + note;
}

// --- Wikilinks ---

function projectToWikilink(projectName: string): string {
  return `[[${projectName}]]`;
}

/** Convert project names in summary lines to wikilinks */
function wikilinkifySummary(summaryLines: string[]): string[] {
  return summaryLines.map((line) => {
    // Convert **[project-name]** to **[[project-name]]**
    return line.replace(/\*\*\[([^\]]+)\]\*\*/g, (_match, name) => `**${projectToWikilink(name)}**`);
  });
}

// --- Decision Callouts ---

function formatDecisions(decisions: DecisionRecord[]): string {
  if (decisions.length === 0) return '';

  const lines: string[] = ['', '## Decisions', ''];
  for (const d of decisions) {
    lines.push(`> [!decision] ${d.title}`);
    lines.push(`> ${d.rationale}`);
    if (d.tradeoff) {
      lines.push(`> **트레이드오프**: ${d.tradeoff}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// --- Template ---

function buildTemplate(date: string): string {
  return `# ${date}

## Focus


## Summary


## Work Log


## Carry Forward


## Stats

`;
}

// --- Core Operations ---

async function readOrCreateNote(filePath: string, date: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    const content = buildTemplate(date);
    await writeFile(filePath, content, 'utf-8');
    return content;
  }
}

function replaceSectionContent(
  note: string,
  sectionHeader: string,
  newContent: string,
): string {
  const lines = note.split('\n');
  const sectionIndex = lines.findIndex((l) => l.trim() === sectionHeader);

  if (sectionIndex === -1) return note;

  let nextSectionIndex = lines.length;
  for (let i = sectionIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      nextSectionIndex = i;
      break;
    }
  }

  const before = lines.slice(0, sectionIndex + 1);
  const after = lines.slice(nextSectionIndex);

  return [...before, newContent, '', ...after].join('\n');
}

function migrateOldSections(note: string): string {
  return note.replace(/^## Yesterday$/m, '## Summary');
}

/** Ensure the Decisions section exists (insert before Stats if needed) */
function ensureDecisionsSection(note: string, decisionsContent: string): string {
  if (!decisionsContent) return note;

  const lines = note.split('\n');

  // If Decisions section already exists, replace it
  const existingIdx = lines.findIndex((l) => l.trim() === '## Decisions');
  if (existingIdx !== -1) {
    let nextSection = lines.length;
    for (let i = existingIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        nextSection = i;
        break;
      }
    }
    const before = lines.slice(0, existingIdx);
    const after = lines.slice(nextSection);
    const decisionLines = decisionsContent.split('\n');
    return [...before, ...decisionLines, ...after].join('\n');
  }

  // Insert before ## Stats
  const statsIdx = lines.findIndex((l) => l.trim() === '## Stats');
  if (statsIdx !== -1) {
    const before = lines.slice(0, statsIdx);
    const after = lines.slice(statsIdx);
    const decisionLines = decisionsContent.split('\n');
    return [...before, ...decisionLines, ...after].join('\n');
  }

  // Fallback: append at end
  return note + decisionsContent;
}

// --- Carry Forward Rollover ---

export interface RolledOverItem {
  content: string;
  originDate: string;
  daysOld: number;
}

/**
 * Read unchecked carry forward items from the past N days.
 * Returns items with their origin date and age.
 */
export async function getUncheckedCarryForward(
  config: ObsidianConfig,
  todayDate: string,
  lookbackDays: number = 7,
): Promise<RolledOverItem[]> {
  const items: RolledOverItem[] = [];
  const today = new Date(`${todayDate}T12:00:00`);

  for (let i = 1; i <= lookbackDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA');

    const note = await readDailyNote(config, dateStr);
    if (!note) continue;

    const carryLines = extractSection(note, SECTION_MARKERS.carryForward);
    for (const line of carryLines) {
      // Match unchecked items: - [ ] content (possibly with "(from MM-DD)" suffix)
      const uncheckedMatch = line.match(/^- \[ \]\s+(.+)/);
      if (!uncheckedMatch) continue;

      let content = uncheckedMatch[1];
      // Strip existing origin date suffix to avoid nesting
      content = content.replace(/\s*\(from \d{2}-\d{2}\)$/, '').trim();
      // Strip existing warning marker
      content = content.replace(/^⚠️\s*/, '').trim();

      // Find the true origin date (might have been rolled over already)
      const originMatch = uncheckedMatch[1].match(/\(from (\d{2}-\d{2})\)$/);
      const originDate = originMatch
        ? `${todayDate.slice(0, 5)}${originMatch[1]}` // reconstruct YYYY-MM-DD
        : dateStr;

      const originD = new Date(`${originDate}T12:00:00`);
      const daysOld = Math.round((today.getTime() - originD.getTime()) / 86_400_000);

      items.push({ content, originDate, daysOld });
    }
  }

  // Deduplicate by content
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.content.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Format carry forward items for Obsidian, including rolled-over items */
export function formatCarryForward(
  todayItems: string[],
  rolledOver: RolledOverItem[],
): string {
  const lines: string[] = [];

  // Rolled-over items first (oldest → newest)
  const sorted = [...rolledOver].sort((a, b) => b.daysOld - a.daysOld);
  for (const item of sorted) {
    const warn = item.daysOld >= 3 ? '⚠️ ' : '';
    const dateTag = `(from ${item.originDate.slice(5)})`; // MM-DD
    lines.push(`- [ ] ${warn}${item.content} ${dateTag}`);
  }

  // Today's new items
  for (const item of todayItems) {
    // Don't duplicate items already in rolled-over
    const isDuplicate = rolledOver.some(
      (r) => r.content.toLowerCase() === item.toLowerCase(),
    );
    if (!isDuplicate) {
      lines.push(`- [ ] ${item}`);
    }
  }

  return lines.join('\n');
}

// --- Public API ---

export async function writeDailySummary(
  config: ObsidianConfig,
  summary: DailySummary,
): Promise<string> {
  const filePath = getDailyNotePath(config, summary.date);
  let note = await readOrCreateNote(filePath, summary.date);

  note = migrateOldSections(note);

  // Frontmatter
  const frontmatter = buildFrontmatter(summary);
  note = replaceFrontmatter(note, frontmatter);

  // Summary with wikilinks
  const wikilinkedSummary = wikilinkifySummary(summary.summary);
  const summaryText = wikilinkedSummary.length > 0
    ? wikilinkedSummary.join('\n')
    : '';
  note = replaceSectionContent(note, SECTION_MARKERS.summary, summaryText);

  // Carry forward with cross-day rollover
  const rolledOver = await getUncheckedCarryForward(config, summary.date);
  const carryText = (summary.carryForward.length > 0 || rolledOver.length > 0)
    ? formatCarryForward(summary.carryForward, rolledOver)
    : '';
  note = replaceSectionContent(note, SECTION_MARKERS.carryForward, carryText);

  // Stats
  note = replaceSectionContent(note, SECTION_MARKERS.stats, summary.stats || '');

  // Decisions (callout blocks)
  const decisionsContent = formatDecisions(summary.decisions);
  note = ensureDecisionsSection(note, decisionsContent);

  await writeFile(filePath, note, 'utf-8');
  return filePath;
}

export async function appendWorkLogEntry(
  config: ObsidianConfig,
  date: string,
  entry: string,
): Promise<string> {
  const filePath = getDailyNotePath(config, date);
  let note = await readOrCreateNote(filePath, date);

  const lines = note.split('\n');
  const workLogIndex = lines.findIndex((l) => l.trim() === SECTION_MARKERS.workLog);

  if (workLogIndex === -1) {
    note += `\n${SECTION_MARKERS.workLog}\n${entry}\n`;
  } else {
    let insertIndex = workLogIndex + 1;
    while (insertIndex < lines.length && !lines[insertIndex].startsWith('## ')) {
      insertIndex++;
    }

    const lastContentIndex = insertIndex - 1;
    while (lastContentIndex > workLogIndex && lines[lastContentIndex].trim() === '') {
      insertIndex--;
    }

    lines.splice(insertIndex, 0, entry);
    note = lines.join('\n');
  }

  await writeFile(filePath, note, 'utf-8');
  return filePath;
}

export async function readDailyNote(
  config: ObsidianConfig,
  date: string,
): Promise<string | null> {
  const filePath = getDailyNotePath(config, date);
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function extractSection(note: string, sectionHeader: string): string[] {
  const lines = note.split('\n');
  const sectionIndex = lines.findIndex((l) => l.trim() === sectionHeader);

  if (sectionIndex === -1) return [];

  const contentLines: string[] = [];
  for (let i = sectionIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    const trimmed = lines[i].trim();
    if (trimmed) contentLines.push(trimmed);
  }

  return contentLines;
}

// --- Weekly Note Writer ---

import type { WeeklySummary } from '../summarizer/weekly.js';

function getWeeklyNotePath(config: ObsidianConfig, week: string): string {
  return join(config.vaultPath, 'Weekly Notes', `${week}.md`);
}

export async function writeWeeklySummary(
  config: ObsidianConfig,
  summary: WeeklySummary,
): Promise<string> {
  const filePath = getWeeklyNotePath(config, summary.week);
  await mkdir(dirname(filePath), { recursive: true });

  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`week: ${summary.week}`);
  lines.push(`date-range: [${summary.dateRange[0]}, ${summary.dateRange[1]}]`);
  lines.push(`type: weekly-log`);
  if (summary.projects.length > 0) {
    lines.push(`projects:`);
    for (const p of summary.projects) lines.push(`  - "[[${p}]]"`);
  }
  lines.push(`total-commits: ${summary.totalCommits}`);
  lines.push(`total-hours: ${summary.totalHours}`);
  lines.push(`total-sessions: ${summary.totalSessions}`);
  if (summary.workTypes.length > 0) {
    lines.push(`work-types:`);
    for (const t of summary.workTypes) lines.push(`  - ${t}`);
  }
  lines.push('---');
  lines.push('');

  // Title
  const weekNum = summary.week.split('-W')[1];
  lines.push(`# Week ${weekNum} (${summary.dateRange[0]} ~ ${summary.dateRange[1]})`);
  lines.push('');

  // Highlights
  lines.push('## 이번 주 핵심');
  lines.push(...summary.highlights);
  lines.push('');

  // Project breakdown
  if (Object.keys(summary.projectBreakdown).length > 0) {
    lines.push('## 프로젝트별 시간');
    for (const [proj, data] of Object.entries(summary.projectBreakdown)) {
      const pct = summary.totalHours > 0 ? Math.round((data.hours / summary.totalHours) * 100) : 0;
      lines.push(`- [[${proj}]]: ${pct}% (~${data.hours}h · ${data.commits} commits)`);
    }
    lines.push('');
  }

  // Decisions
  if (summary.decisions.length > 0) {
    lines.push('## 주요 결정');
    for (const d of summary.decisions) lines.push(d);
    lines.push('');
  }

  // Carry forward
  if (summary.carryForward.length > 0) {
    lines.push('## 다음 주 이월');
    for (const item of summary.carryForward) lines.push(`- [ ] ${item}`);
    lines.push('');
  }

  // Stats
  lines.push('## Stats');
  lines.push(summary.stats);
  lines.push('');

  await writeFile(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

export async function writeFocusSection(
  config: ObsidianConfig,
  date: string,
  focus: string,
): Promise<string> {
  const filePath = getDailyNotePath(config, date);
  let note = await readOrCreateNote(filePath, date);
  note = replaceSectionContent(note, SECTION_MARKERS.focus, focus);
  await writeFile(filePath, note, 'utf-8');
  return filePath;
}

export { SECTION_MARKERS, getDailyNotePath, getWeeklyNotePath };
