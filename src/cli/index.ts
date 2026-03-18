#!/usr/bin/env node

const command = process.argv[2];

switch (command) {
  case 'daily':
  case 'summary':
    import('./daily-summary.js').then((mod) => mod.default());
    break;
  default:
    console.log('Usage: ahl <command>');
    console.log('');
    console.log('Commands:');
    console.log('  daily    Generate today\'s daily summary');
    console.log('  summary  Alias for daily');
    process.exit(0);
}
