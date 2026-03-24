import { loadConfig } from '../config/index.js';
import { getAllSessionsForDate } from '../analyzers/session.js';
import { getGitSummaryForDate } from '../analyzers/git.js';
import { summarizeDay } from '../summarizer/index.js';
import { writeDailySummary } from '../obsidian/writer.js';
import { saveDailySummary } from '../memory/store.js';

function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

export default async function dailySummary() {
  const date = process.argv[3] ?? new Date().toLocaleDateString('en-CA');
  console.error(`Generating daily summary for ${date}...`);
  const t0 = performance.now();

  const config = await loadConfig();

  let t = performance.now();
  const sessions = await getAllSessionsForDate(config.session, date);
  console.error(`  sessions: ${sessions.length} found (${elapsed(t)})`);

  t = performance.now();
  const git = await getGitSummaryForDate(config.git.repos, date, config.git.authorEmail);
  console.error(`  git: ${git.reduce((s, g) => s + g.commits.length, 0)} commits (${elapsed(t)})`);

  t = performance.now();
  const summary = await summarizeDay({ date, sessions, git }, config.summarizer);
  console.error(`  summarize: ${summary.projects.length} projects (${elapsed(t)})`);

  console.log(`# ${summary.date}\n`);

  if (summary.projects.length > 0) {
    console.log(`Projects: ${summary.projects.join(', ')}`);
  }
  if (summary.workTypes.length > 0) {
    console.log(`Work types: ${summary.workTypes.map((t) => `#${t}`).join(' ')}`);
  }
  console.log('');

  console.log(`## Summary`);
  for (const line of summary.summary) {
    console.log(line);
  }
  console.log('');

  if (summary.decisions.length > 0) {
    console.log(`## Decisions`);
    for (const d of summary.decisions) {
      console.log(`- ${d.title}: ${d.rationale}`);
      if (d.tradeoff) console.log(`  Tradeoff: ${d.tradeoff}`);
    }
    console.log('');
  }

  if (summary.carryForward.length > 0) {
    console.log(`## Carry Forward`);
    for (const item of summary.carryForward) {
      console.log(`- [ ] ${item}`);
    }
    console.log('');
  }

  console.log(`## Stats`);
  console.log(summary.stats);

  if (Object.keys(summary.flowDistribution).length > 0) {
    const flowStr = Object.entries(summary.flowDistribution)
      .sort(([, a], [, b]) => b - a)
      .map(([type, pct]) => `${type} ${pct}%`)
      .join(' → ');
    console.log(`\n## Flow`);
    console.log(flowStr);
  }

  t = performance.now();
  const filePath = await writeDailySummary(config.obsidian, summary);
  saveDailySummary(config.memory, summary);
  console.error(`  write: obsidian + sqlite (${elapsed(t)})`);
  console.error(`  total: ${elapsed(t0)}`);
  console.error(`\nWritten to ${filePath}`);
}
