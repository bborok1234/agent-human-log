import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'agent-human-log',
  version: '0.1.0',
});

server.registerTool(
  'daily_summary',
  {
    description:
      'Generate a compressed daily summary from AI sessions + git commits and write to Obsidian daily note',
    inputSchema: z.object({
      date: z
        .string()
        .optional()
        .describe('Date in YYYY-MM-DD format. Defaults to today.'),
    }),
  },
  async ({ date }) => {
    const targetDate = date ?? new Date().toISOString().split('T')[0];
    // TODO: implement — collect sessions + git → summarize → write to Obsidian
    return {
      content: [
        { type: 'text' as const, text: `Daily summary for ${targetDate}: not yet implemented` },
      ],
    };
  },
);

server.registerTool(
  'log_milestone',
  {
    description:
      'Append a timestamped work entry to today\'s Obsidian daily note. Call this at natural breakpoints: after a commit, PR, or completing a significant task.',
    inputSchema: z.object({
      entry: z.string().describe('Brief description of what was accomplished'),
      project: z.string().optional().describe('Project name, auto-detected from cwd if omitted'),
    }),
  },
  async ({ entry, project }) => {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const projectTag = project ? `[${project}]` : '';
    const logLine = `- ${time} ${projectTag} ${entry}`;
    // TODO: implement — append logLine to today's daily note under "## Work Log"
    return {
      content: [{ type: 'text' as const, text: `Logged: ${logLine}` }],
    };
  },
);

server.registerTool(
  'get_yesterday',
  {
    description:
      'Get yesterday\'s work summary and carry-forward items. Use this at the start of a new day to provide context.',
    inputSchema: z.object({}),
  },
  async () => {
    // TODO: implement — read yesterday's daily note, extract summary + carry forward
    return {
      content: [{ type: 'text' as const, text: 'Yesterday summary: not yet implemented' }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('agent-human-log MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
