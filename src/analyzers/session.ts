import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionEntry } from '../types/index.js';

interface RawSessionMessage {
  type: string;
  message?: {
    role: string;
    content: string;
  };
  timestamp?: string;
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

async function parseJsonlSession(
  filePath: string,
  date: string,
  projectDir: string,
): Promise<SessionEntry | null> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  const userMessages: string[] = [];
  const timestamps: Date[] = [];
  const agentsUsed = new Set<string>();
  let sessionId = '';

  for (const line of lines) {
    try {
      const msg: RawSessionMessage = JSON.parse(line);

      if (msg.timestamp) {
        const msgDate = new Date(msg.timestamp);
        const msgDateStr = msgDate.toISOString().split('T')[0];
        if (msgDateStr !== date) continue;
        timestamps.push(msgDate);
      }

      if (msg.message?.role === 'user' && msg.message.content) {
        userMessages.push(msg.message.content);
      }

      if (msg.type === 'session') {
        sessionId = filePath;
      }
    } catch {
      // intentionally ignored — malformed JSONL line
    }
  }

  if (userMessages.length === 0) return null;

  const projectName = projectDir.split('/').pop() ?? 'unknown';
  const firstTs = timestamps[0] ?? new Date();
  const lastTs = timestamps[timestamps.length - 1] ?? firstTs;
  const durationMinutes = Math.round(
    (lastTs.getTime() - firstTs.getTime()) / 60_000,
  );

  return {
    sessionId: sessionId || filePath,
    timestamp: firstTs,
    project: projectName,
    userMessages,
    agentsUsed: Array.from(agentsUsed),
    messageCount: userMessages.length,
    completedTodos: [],
    durationMinutes,
  };
}
