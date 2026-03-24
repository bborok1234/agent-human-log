import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionEntry, SessionConfig } from '../types/index.js';
import { getOpenCodeSessionsForDate } from './opencode.js';

interface ContentBlock {
  type: 'text' | 'tool_result' | 'tool_reference' | 'thinking' | 'tool_use';
  text?: string;
  content?: string | ContentBlock[];
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface RawSessionLine {
  type: 'user' | 'assistant' | 'progress' | 'file-history-snapshot' | 'tool_use' | 'tool_result';
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

/** Meaningful bash commands worth logging (test, build, deploy, git operations) */
const MEANINGFUL_COMMAND_PATTERNS = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|typecheck|deploy|publish)/,
  /\b(vitest|jest|mocha|pytest|go\s+test|cargo\s+test)/,
  /\bgit\s+(push|merge|rebase|cherry-pick|tag)/,
  /\b(docker|kubectl|terraform|pulumi)\s+/,
  /\bgh\s+(pr|issue|release)\s+/,
  /\b(make|gradle|mvn|cargo)\s+(build|release|deploy)/,
  /\bcurl\s+.*-X\s+(POST|PUT|DELETE|PATCH)/,
];

function isMeaningfulCommand(cmd: string): boolean {
  return MEANINGFUL_COMMAND_PATTERNS.some((p) => p.test(cmd));
}

interface ToolUseData {
  filesEdited: string[];
  commandsRun: string[];
  toolUseCounts: Record<string, number>;
  /** Ordered tool names for flow analysis */
  toolNames: string[];
}

function extractToolUseFromContent(content: string | ContentBlock[]): ToolUseData {
  const data: ToolUseData = { filesEdited: [], commandsRun: [], toolUseCounts: {}, toolNames: [] };

  if (typeof content === 'string') return data;

  for (const block of content) {
    if (block.type !== 'tool_use' || !block.name) continue;

    data.toolUseCounts[block.name] = (data.toolUseCounts[block.name] ?? 0) + 1;
    data.toolNames.push(block.name);

    const input = block.input;
    if (!input) continue;

    if (block.name === 'Edit' || block.name === 'Write') {
      const filePath = input['file_path'] as string | undefined;
      if (filePath) {
        // Normalize to relative path (strip home dir prefix)
        const normalized = filePath.replace(/^\/Users\/[^/]+\//, '~/');
        data.filesEdited.push(normalized);
      }
    }

    if (block.name === 'Bash') {
      const cmd = input['command'] as string | undefined;
      if (cmd && isMeaningfulCommand(cmd)) {
        // Keep first 120 chars of meaningful commands
        data.commandsRun.push(cmd.length > 120 ? cmd.slice(0, 120) + '...' : cmd);
      }
    }
  }

  return data;
}

export async function getAllSessionsForDate(
  sessionConfig: SessionConfig,
  date: string,
): Promise<SessionEntry[]> {
  const claudeSessions = await getClaudeCodeSessionsForDate(
    sessionConfig.claudeCodeDir,
    date,
  );
  const opencodeSessions = getOpenCodeSessionsForDate(
    sessionConfig.openCodeDb,
    date,
  );

  return [...claudeSessions, ...opencodeSessions]
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

export async function getClaudeCodeSessionsForDate(
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

/** Extract project name from actual working directory path (e.g., /Users/mirlim/searchright/agent-human-log → agent-human-log) */
function projectNameFromCwd(cwd: string): string | null {
  if (!cwd) return null;
  const name = cwd.split('/').pop();
  return name || null;
}

/** Fallback: extract project name from Claude Code's encoded directory name */
function projectNameFromDir(projectDir: string): string {
  const dirName = projectDir.split('/').pop() ?? 'unknown';
  // Best effort: take after the username portion, keep last hyphenated segment
  // e.g., -Users-mirlim-searchright-agent-human-log → last real dir name is ambiguous
  // so we just return the whole thing stripped of the user prefix
  return dirName.replace(/^-Users-[^-]+-/, '').replace(/-/g, '/');
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
  let sessionCwd = '';

  const allFilesEdited: string[] = [];
  const allCommandsRun: string[] = [];
  const mergedToolCounts: Record<string, number> = {};
  const allToolSequence: string[] = [];

  for (const line of lines) {
    try {
      const msg: RawSessionLine = JSON.parse(line);

      if (msg.isSidechain) continue;

      if (msg.sessionId && !sessionId) {
        sessionId = msg.sessionId;
      }
      if (msg.cwd && !sessionCwd) {
        sessionCwd = msg.cwd;
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

      // Extract tool_use signals from assistant messages
      if (
        (msg.type === 'assistant' || msg.type === 'tool_use') &&
        msg.message?.content &&
        typeof msg.message.content !== 'string'
      ) {
        const toolData = extractToolUseFromContent(msg.message.content);
        allFilesEdited.push(...toolData.filesEdited);
        allCommandsRun.push(...toolData.commandsRun);
        allToolSequence.push(...toolData.toolNames);
        for (const [tool, count] of Object.entries(toolData.toolUseCounts)) {
          mergedToolCounts[tool] = (mergedToolCounts[tool] ?? 0) + count;
        }
      }
    } catch {
      // intentionally ignored — malformed JSONL line
    }
  }

  if (!hasMatchingDate || userMessages.length === 0) return null;

  // Derive project name from cwd (actual working directory) if available,
  // otherwise fall back to the Claude Code directory name
  const projectName = projectNameFromCwd(sessionCwd) ?? projectNameFromDir(projectDir);

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
    pendingTodos: [],
    durationMinutes,
    filesEdited: [...new Set(allFilesEdited)],
    commandsRun: [...new Set(allCommandsRun)],
    toolUseCounts: mergedToolCounts,
    toolSequence: allToolSequence,
  };
}
