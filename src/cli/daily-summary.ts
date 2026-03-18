import { getSessionsForDate } from '../analyzers/session.js';
import { getGitSummaryForDate } from '../analyzers/git.js';
import { summarizeDay } from '../summarizer/index.js';

export default async function dailySummary() {
  const today = new Date().toISOString().split('T')[0];
  console.error(`Generating daily summary for ${today}...`);

  // TODO: load config from file
  const config = {
    claudeCodeDir: `${process.env['HOME']}/.claude/projects`,
    repos: [] as string[],
    authorEmail: '',
  };

  const sessions = await getSessionsForDate(config.claudeCodeDir, today);
  const git = await getGitSummaryForDate(config.repos, today, config.authorEmail);

  const summary = await summarizeDay({ date: today, sessions, git });

  console.log(`# ${summary.date}\n`);
  console.log(`## Summary`);
  for (const line of summary.summary) {
    console.log(`- ${line}`);
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
}
