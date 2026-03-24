import Database from 'better-sqlite3';
import type { SessionEntry } from '../types/index.js';

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
}

interface MessageWithParts {
  message_id: string;
  role: string;
  agent: string;
  time_created: number;
  part_type: string;
  part_text: string;
}

export function getOpenCodeSessionsForDate(
  dbPath: string,
  date: string,
): SessionEntry[] {
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    console.error(`Cannot open OpenCode DB: ${dbPath}`);
    return [];
  }

  try {
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const dayEnd = new Date(`${date}T23:59:59.999`).getTime();

    const sessions = db.prepare(`
      SELECT id, title, directory, time_created, time_updated
      FROM session
      WHERE time_created >= ? AND time_created <= ?
        AND parent_id IS NULL
      ORDER BY time_created ASC
    `).all(dayStart, dayEnd) as SessionRow[];

    const entries: SessionEntry[] = [];

    for (const session of sessions) {
      const entry = buildSessionEntry(db, session);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  } finally {
    db.close();
  }
}

function buildSessionEntry(
  db: Database.Database,
  session: SessionRow,
): SessionEntry | null {
  const rows = db.prepare(`
    SELECT
      m.id as message_id,
      json_extract(m.data, '$.role') as role,
      json_extract(m.data, '$.agent') as agent,
      m.time_created,
      json_extract(p.data, '$.type') as part_type,
      json_extract(p.data, '$.text') as part_text
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = ?
    ORDER BY m.time_created ASC
  `).all(session.id) as MessageWithParts[];

  const userMessages: string[] = [];
  const agents = new Set<string>();
  const timestamps: number[] = [];

  for (const row of rows) {
    timestamps.push(row.time_created);

    if (row.agent) {
      agents.add(row.agent);
    }

    if (row.role === 'user' && row.part_type === 'text' && row.part_text) {
      const text = row.part_text.trim();
      if (text.length >= 5 && !isSystemMessage(text)) {
        userMessages.push(text);
      }
    }
  }

  if (userMessages.length === 0) return null;

  const dirParts = session.directory.split('/');
  const projectName = dirParts.slice(-2).join('/');

  const firstTs = timestamps[0] ?? session.time_created;
  const lastTs = timestamps[timestamps.length - 1] ?? session.time_updated;
  const durationMinutes = Math.round((lastTs - firstTs) / 60_000);

  return {
    sessionId: session.id,
    timestamp: new Date(firstTs),
    project: projectName,
    userMessages,
    agentsUsed: Array.from(agents),
    messageCount: userMessages.length,
    completedTodos: [],
    durationMinutes,
    filesEdited: [],
    commandsRun: [],
    toolUseCounts: {},
  };
}

const SYSTEM_PATTERNS = [
  /^<system-reminder>/,
  /^<local-command/,
  /^<command-name>/,
  /^<!-- OMO_INTERNAL/,
  /^\[SYSTEM DIRECTIVE/,
];

function isSystemMessage(msg: string): boolean {
  const firstLine = msg.split('\n')[0].trim();
  return SYSTEM_PATTERNS.some((p) => p.test(firstLine));
}
