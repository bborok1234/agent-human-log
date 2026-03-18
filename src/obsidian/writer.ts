import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { ObsidianConfig, DailySummary } from '../types/index.js';

const SECTION_MARKERS = {
  focus: '## Focus',
  summary: '## Summary',
  workLog: '## Work Log',
  carryForward: '## Carry Forward',
  stats: '## Stats',
} as const;

const TEMPLATE = `# {{date}}

## Focus


## Summary


## Work Log


## Carry Forward


## Stats

`;

function getDailyNotePath(config: ObsidianConfig, date: string): string {
  return join(config.vaultPath, config.dailyNotesDir, `${date}.md`);
}

async function readOrCreateNote(filePath: string, date: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    const content = TEMPLATE.replace('{{date}}', date);
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

export async function writeDailySummary(
  config: ObsidianConfig,
  summary: DailySummary,
): Promise<string> {
  const filePath = getDailyNotePath(config, summary.date);
  let note = await readOrCreateNote(filePath, summary.date);

  if (summary.summary.length > 0) {
    const summaryText = summary.summary.map((s) => `- ${s}`).join('\n');
    note = replaceSectionContent(note, SECTION_MARKERS.summary, summaryText);
  }

  if (summary.carryForward.length > 0) {
    const carryText = summary.carryForward.map((c) => `- [ ] ${c}`).join('\n');
    note = replaceSectionContent(note, SECTION_MARKERS.carryForward, carryText);
  }

  if (summary.stats) {
    note = replaceSectionContent(note, SECTION_MARKERS.stats, summary.stats);
  }

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
