#!/usr/bin/env node

const command = process.argv[2];

switch (command) {
  case 'daily':
  case 'summary':
    import('./daily-summary.js').then((mod) => mod.default());
    break;
  case 'weekly':
    import('./weekly-summary.js').then((mod) => mod.default());
    break;
  default:
    console.log('Usage: ahl <command> [date]');
    console.log('');
    console.log('Commands:');
    console.log('  daily    Generate today\'s daily summary');
    console.log('  summary  Alias for daily');
    console.log('  weekly   Generate weekly summary (date defaults to this week)');
    process.exit(0);
}
