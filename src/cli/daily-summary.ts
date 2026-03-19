import { loadConfig } from '../config/index.js';
import { getAllSessionsForDate } from '../analyzers/session.js';
import { getGitSummaryForDate } from '../analyzers/git.js';
import { summarizeDay } from '../summarizer/index.js';
import { writeDailySummary } from '../obsidian/writer.js';

export default async function dailySummary() {
  const date = process.argv[3] ?? new Date().toLocaleDateString('en-CA');
  console.error(`Generating daily summary for ${date}...`);

  const config = await loadConfig();

  const sessions = await getAllSessionsForDate(config.session, date);
  const git = await getGitSummaryForDate(config.git.repos, date, config.git.authorEmail);
  const summary = await summarizeDay({ date, sessions, git }, config.summarizer);

  console.log(`# ${summary.date}\n`);
  console.log(`## Summary`);
  for (const line of summary.summary) {
    console.log(line);
  }
  console.log('');

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
  console.error(`\nWritten to ${filePath}`);
}
