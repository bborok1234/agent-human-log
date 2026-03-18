import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionEntry } from '../types/index.js';

interface ContentBlock {
  type: 'text' | 'tool_result' | 'tool_reference' | 'thinking' | 'tool_use';
  text?: string;
  content?: string | ContentBlock[];
  thinking?: string;
  name?: string;
}

interface RawSessionLine {
  type: 'user' | 'assistant' | 'progress' | 'file-history-snapshot';
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  isSidechain?: boolean;
  message?: {
    role: 'user' | 'assistant';
    model?: string;
    content: string | ContentBlock[];
  };
}

export async function getSessionsForDate(
  claudeCodeDir: string,
  date: string,
): Promise<SessionEntry[]> {
  const sessions: SessionEntry[] = [];
  const projectDirs = await findProjectDirs(claudeCodeDir);

  for (const projectDir of projectDirs) {
    const projectSessions = await parseProjectSessions(projectDir, date);
    sessions.push(...projectSessions);
  }

  return sessions;
}

async function findProjectDirs(baseDir: string): Promise<string[]> {
  const dirs: string[] = [];
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(join(baseDir, entry.name));
      }
    }
  } catch {
    console.error(`Cannot read session directory: ${baseDir}`);
  }
  return dirs;
}

async function parseProjectSessions(
  projectDir: string,
  date: string,
): Promise<SessionEntry[]> {
  const sessions: SessionEntry[] = [];

  try {
    const files = await readdir(projectDir);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

    for (const file of jsonlFiles) {
      const filePath = join(projectDir, file);
      const entry = await parseJsonlSession(filePath, date, projectDir);
      if (entry) {
        sessions.push(entry);
      }
    }
  } catch {
    // intentionally ignored — dir may not exist
  }

  return sessions;
}

function extractTextFromContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;

  return content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text!)
    .join('\n');
}

async function parseJsonlSession(
  filePath: string,
  date: string,
  projectDir: string,
): Promise<SessionEntry | null> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  const userMessages: string[] = [];
  const timestamps: Date[] = [];
  let sessionId = '';
  let hasMatchingDate = false;

  for (const line of lines) {
    try {
      const msg: RawSessionLine = JSON.parse(line);

      if (msg.isSidechain) continue;

      if (msg.sessionId && !sessionId) {
        sessionId = msg.sessionId;
      }

      if (!msg.timestamp) continue;

      const msgDate = new Date(msg.timestamp);
      const msgDateStr = msgDate.toLocaleDateString('en-CA');
      if (msgDateStr !== date) continue;

      hasMatchingDate = true;
      timestamps.push(msgDate);

      if (msg.type === 'user' && msg.message?.role === 'user' && msg.message.content) {
        const text = extractTextFromContent(msg.message.content);
        if (text.trim()) {
          userMessages.push(text.trim());
        }
      }
    } catch {
      // intentionally ignored — malformed JSONL line
    }
  }

  if (!hasMatchingDate || userMessages.length === 0) return null;

  const dirName = projectDir.split('/').pop() ?? 'unknown';
  const projectName = dirName.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');

  const firstTs = timestamps[0]!;
  const lastTs = timestamps[timestamps.length - 1]!;
  const durationMinutes = Math.round(
    (lastTs.getTime() - firstTs.getTime()) / 60_000,
  );

  return {
    sessionId: sessionId || filePath,
    timestamp: firstTs,
    project: projectName,
    userMessages,
    agentsUsed: [],
    messageCount: userMessages.length,
    completedTodos: [],
    durationMinutes,
  };
}
