import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { ObsidianConfig, DailySummary, DecisionRecord } from '../types/index.js';

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

  // Carry forward
  const carryText = summary.carryForward.length > 0
    ? summary.carryForward.map((c) => `- [ ] ${c}`).join('\n')
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

export { SECTION_MARKERS, getDailyNotePath };
