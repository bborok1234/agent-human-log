import { loadConfig } from '../config/index.js';
import { summarizeWeek } from '../summarizer/weekly.js';
import { writeWeeklySummary } from '../obsidian/writer.js';

export default async function weeklySummary() {
  const dateArg = process.argv[3] ?? new Date().toLocaleDateString('en-CA');
  console.error(`Generating weekly summary for week containing ${dateArg}...`);

  const config = await loadConfig();
  const summary = await summarizeWeek(config.obsidian, config.summarizer, dateArg);

  console.log(`# ${summary.week} (${summary.dateRange[0]} ~ ${summary.dateRange[1]})\n`);

  if (summary.projects.length > 0) {
    console.log(`Projects: ${summary.projects.join(', ')}`);
  }
  console.log('');

  console.log('## 이번 주 핵심');
  for (const line of summary.highlights) {
    console.log(line);
  }
  console.log('');

  if (Object.keys(summary.projectBreakdown).length > 0) {
    console.log('## 프로젝트별 시간');
    for (const [proj, data] of Object.entries(summary.projectBreakdown)) {
      const pct = summary.totalHours > 0 ? Math.round((data.hours / summary.totalHours) * 100) : 0;
      console.log(`- ${proj}: ${pct}% (~${data.hours}h · ${data.commits} commits)`);
    }
    console.log('');
  }

  if (summary.carryForward.length > 0) {
    console.log('## 다음 주 이월');
    for (const item of summary.carryForward) {
      console.log(`- [ ] ${item}`);
    }
    console.log('');
  }

  console.log('## Stats');
  console.log(summary.stats);

  const filePath = await writeWeeklySummary(config.obsidian, summary);
  console.error(`\nWritten to ${filePath}`);
}
