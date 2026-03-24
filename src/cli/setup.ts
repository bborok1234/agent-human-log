import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');

export default function setup() {
  const mcpServerPath = resolve(projectRoot, 'dist', 'mcp-server', 'index.js');
  const serverName = 'agent-human-log';

  console.log('Setting up agent-human-log MCP server for Claude Code...\n');

  // 1. Register MCP server
  try {
    // Remove existing if any (ignore errors)
    try { execSync(`claude mcp remove ${serverName}`, { stdio: 'ignore' }); } catch { /* ok */ }

    execSync(`claude mcp add ${serverName} -- node ${mcpServerPath}`, { stdio: 'inherit' });
    console.log(`\n✓ MCP server registered: ${serverName}`);
    console.log(`  Command: node ${mcpServerPath}`);
  } catch (error) {
    console.error('✗ Failed to register MCP server.');
    console.error('  Make sure Claude Code CLI is installed: npm install -g @anthropic-ai/claude-code');
    console.error('  Or register manually:');
    console.error(`  claude mcp add ${serverName} -- node ${mcpServerPath}`);
    process.exit(1);
  }

  // 2. Show available tools and skills
  console.log('\n--- Available MCP Tools ---');
  console.log('  daily_summary      Generate daily work summary');
  console.log('  log_milestone      Log a work milestone');
  console.log('  get_yesterday      Get yesterday\'s summary');
  console.log('  weekly_summary     Generate weekly summary');
  console.log('  set_focus          Set today\'s focus');
  console.log('  get_recommendations Get prioritized recommendations');
  console.log('  resolve_carry_item  Mark carry item as done/dropped');
  console.log('  log_decision       Record a decision');
  console.log('  search_history     Search past work history');

  console.log('\n--- Available Slash Commands ---');
  console.log('  /morning           Morning briefing');
  console.log('  /log-decision      Record a decision');
  console.log('  /search            Search work history');
  console.log('  /daily             Generate daily summary');
  console.log('  /work-logger       Auto-log milestones (background)');

  console.log('\n✓ Setup complete! Restart Claude Code to activate.');
}
