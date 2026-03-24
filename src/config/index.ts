import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../types/index.js';

const ConfigSchema = z.object({
  obsidian: z.object({
    vaultPath: z.string(),
    dailyNotesDir: z.string().default('Daily Notes'),
    dateFormat: z.string().default('YYYY-MM-DD'),
  }),
  git: z.object({
    repos: z.array(z.string()).default([]),
    authorEmail: z.string().default(''),
  }),
  session: z.object({
    claudeCodeDir: z.string().default('~/.claude/projects'),
    openCodeDb: z.string().default('~/.local/share/opencode/opencode.db'),
  }),
  summarizer: z.object({
    provider: z.enum(['anthropic', 'openai', 'ollama']).default('anthropic'),
    model: z.string().default('claude-haiku-4-5-20251001'),
    maxTokens: z.number().default(2048),
  }),
  memory: z.object({
    dbPath: z.string().default('~/.local/share/agent-human-log/memory.db'),
  }).default({}),
});

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return join(homedir(), filepath.slice(1));
  }
  return filepath;
}

function resolveAllPaths(config: Config): Config {
  return {
    ...config,
    obsidian: {
      ...config.obsidian,
      vaultPath: expandHome(config.obsidian.vaultPath),
      dailyNotesDir: config.obsidian.dailyNotesDir,
    },
    git: {
      ...config.git,
      repos: config.git.repos.map(expandHome),
    },
    session: {
      claudeCodeDir: expandHome(config.session.claudeCodeDir),
      openCodeDb: expandHome(config.session.openCodeDb),
    },
    summarizer: config.summarizer,
    memory: {
      dbPath: expandHome(config.memory.dbPath),
    },
  };
}

const CONFIG_SEARCH_PATHS = [
  'config/config.json',
  'config.json',
  join(homedir(), '.config', 'agent-human-log', 'config.json'),
];

export async function loadConfig(explicitPath?: string): Promise<Config> {
  const paths = explicitPath ? [explicitPath] : CONFIG_SEARCH_PATHS;

  for (const configPath of paths) {
    try {
      const raw = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const validated = ConfigSchema.parse(parsed);
      return resolveAllPaths(validated);
    } catch {
      // intentionally ignored — try next path
    }
  }

  throw new Error(
    `No config found. Searched: ${paths.join(', ')}. Copy config.example.json to config.json and edit.`,
  );
}

export { expandHome };
