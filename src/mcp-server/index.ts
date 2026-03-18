import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from '../config/index.js';
import { getSessionsForDate } from '../analyzers/session.js';
import { getGitSummaryForDate } from '../analyzers/git.js';
import { summarizeDay } from '../summarizer/index.js';
import {
  writeDailySummary,
  appendWorkLogEntry,
  readDailyNote,
  extractSection,
  SECTION_MARKERS,
} from '../obsidian/writer.js';
import type { Config } from '../types/index.js';

let configCache: Config | null = null;

async function getConfig(): Promise<Config> {
  if (!configCache) {
    configCache = await loadConfig();
  }
  return configCache;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

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
    const targetDate = date ?? todayStr();
    const config = await getConfig();

    const sessions = await getSessionsForDate(
      config.session.claudeCodeDir,
      targetDate,
    );
    const git = await getGitSummaryForDate(
      config.git.repos,
      targetDate,
      config.git.authorEmail,
    );

    const summary = await summarizeDay({ date: targetDate, sessions, git });
    const filePath = await writeDailySummary(config.obsidian, summary);

    const lines = [
      `Written to ${filePath}`,
      '',
      `Sessions: ${sessions.length}`,
      `Git repos: ${git.length}`,
      '',
      '## Summary',
      ...summary.summary.map((s) => `- ${s}`),
      '',
      `## Stats`,
      summary.stats,
    ];

    if (summary.carryForward.length > 0) {
      lines.push('', '## Carry Forward');
      lines.push(...summary.carryForward.map((c) => `- [ ] ${c}`));
    }

    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
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
    const config = await getConfig();
    const date = todayStr();
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const projectTag = project ? `[${project}] ` : '';
    const logLine = `- ${time} ${projectTag}${entry}`;

    const filePath = await appendWorkLogEntry(config.obsidian, date, logLine);

    return {
      content: [{ type: 'text' as const, text: `Logged to ${filePath}: ${logLine}` }],
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
    const config = await getConfig();
    const date = yesterdayStr();
    const note = await readDailyNote(config.obsidian, date);

    if (!note) {
      return {
        content: [{ type: 'text' as const, text: `No daily note found for ${date}.` }],
      };
    }

    const summary = extractSection(note, SECTION_MARKERS.yesterday);
    const carryForward = extractSection(note, SECTION_MARKERS.carryForward);
    const stats = extractSection(note, SECTION_MARKERS.stats);
    const focus = extractSection(note, SECTION_MARKERS.focus);

    const lines = [`# Yesterday (${date})`];

    if (focus.length > 0) {
      lines.push('', '## Focus was', ...focus);
    }
    if (summary.length > 0) {
      lines.push('', '## What was done', ...summary);
    }
    if (carryForward.length > 0) {
      lines.push('', '## Carry Forward', ...carryForward);
    }
    if (stats.length > 0) {
      lines.push('', '## Stats', ...stats);
    }

    if (lines.length === 1) {
      lines.push('', 'Note exists but no content in tracked sections.');
    }

    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
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
