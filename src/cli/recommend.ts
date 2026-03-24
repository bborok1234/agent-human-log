import { loadConfig } from '../config/index.js';
import { getRecommendations } from '../memory/store.js';

export default async function recommend() {
  const date = process.argv[3] ?? new Date().toLocaleDateString('en-CA');
  const config = await loadConfig();
  const recs = getRecommendations(config.memory, date);

  if (recs.length === 0) {
    console.log(`No recommendations for ${date}. Start fresh!`);
    return;
  }

  console.log(`## 오늘 추천 (${date})\n`);
  let idx = 1;
  for (const rec of recs) {
    let prefix = '';
    if (rec.type === 'focus') prefix = '🎯 ';
    else if (rec.type === 'carry_forward' && rec.meta?.daysOld && rec.meta.daysOld >= 3) prefix = '⚠️ ';

    let suffix = '';
    if (rec.type === 'carry_forward' && rec.meta?.daysOld) {
      suffix = ` (${rec.meta.daysOld}일째 이월)`;
    }
    if (rec.type === 'recent_project') {
      suffix = ' (최근 작업)';
    }

    console.log(`${idx}. ${prefix}${rec.text}${suffix}`);
    idx++;
  }
}
