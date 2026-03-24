import { loadConfig } from '../config/index.js';
import { getAllSessionsForDate } from '../analyzers/session.js';
import { getGitSummaryForDate } from '../analyzers/git.js';
import { summarizeDay } from '../summarizer/index.js';
import { writeDailySummary } from '../obsidian/writer.js';
import { saveDailySummary } from '../memory/store.js';

export default async function dailySummary() {
  const date = process.argv[3] ?? new Date().toLocaleDateString('en-CA');
  console.error(`Generating daily summary for ${date}...`);

  const config = await loadConfig();

  const sessions = await getAllSessionsForDate(config.session, date);
  const git = await getGitSummaryForDate(config.git.repos, date, config.git.authorEmail);
  const summary = await summarizeDay({ date, sessions, git }, config.summarizer);

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

  const filePath = await writeDailySummary(config.obsidian, summary);
  saveDailySummary(config.memory, summary);
  console.error(`\nWritten to ${filePath}`);
}
