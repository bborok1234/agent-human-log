import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DailySummary, MemoryConfig } from '../types/index.js';

// --- Types ---

export interface CarryItem {
  id: number;
  content: string;
  originDate: string;
  status: 'open' | 'done' | 'dropped';
  resolvedDate: string | null;
  project: string | null;
}

export interface StoredDailySummary {
  date: string;
  projects: string[];
  summary: string;
  carryForward: string[];
  stats: string;
  workTypes: string[];
  decisions: string[];
  focus: string | null;
  hours: number;
  commits: number;
  sessions: number;
  createdAt: string;
}

// --- Store ---

let dbInstance: Database.Database | null = null;

function getDb(config: MemoryConfig): Database.Database {
  if (dbInstance) return dbInstance;

  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  dbInstance = db;
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_summary (
      date TEXT PRIMARY KEY,
      projects TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      carry_forward TEXT NOT NULL DEFAULT '[]',
      stats TEXT NOT NULL DEFAULT '',
      work_types TEXT NOT NULL DEFAULT '[]',
      decisions TEXT NOT NULL DEFAULT '[]',
      focus TEXT,
      hours REAL NOT NULL DEFAULT 0,
      commits INTEGER NOT NULL DEFAULT 0,
      sessions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS carry_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      origin_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_date TEXT,
      project TEXT,
      UNIQUE(content, origin_date)
    );

    CREATE INDEX IF NOT EXISTS idx_carry_item_status ON carry_item(status);
    CREATE INDEX IF NOT EXISTS idx_carry_item_origin ON carry_item(origin_date);
  `);
}

// --- Daily Summary Operations ---

export function saveDailySummary(config: MemoryConfig, summary: DailySummary): void {
  const db = getDb(config);

  const stmt = db.prepare(`
    INSERT INTO daily_summary (date, projects, summary, carry_forward, stats, work_types, decisions, hours, commits, sessions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      projects = excluded.projects,
      summary = excluded.summary,
      carry_forward = excluded.carry_forward,
      stats = excluded.stats,
      work_types = excluded.work_types,
      decisions = excluded.decisions,
      hours = excluded.hours,
      commits = excluded.commits,
      sessions = excluded.sessions
  `);

  const decisionsJson = summary.decisions.map((d) => `${d.title}: ${d.rationale}`);

  stmt.run(
    summary.date,
    JSON.stringify(summary.projects),
    summary.summary.join('\n'),
    JSON.stringify(summary.carryForward),
    summary.stats,
    JSON.stringify(summary.workTypes),
    JSON.stringify(decisionsJson),
    summary.hours,
    summary.commits,
    summary.sessions,
  );

  // Sync carry forward items
  syncCarryItems(db, summary.date, summary.carryForward, summary.projects);
}

function syncCarryItems(
  db: Database.Database,
  date: string,
  carryForward: string[],
  projects: string[],
): void {
  const defaultProject = projects[0] ?? null;

  const insertStmt = db.prepare(`
    INSERT INTO carry_item (content, origin_date, project)
    VALUES (?, ?, ?)
    ON CONFLICT(content, origin_date) DO NOTHING
  `);

  for (const item of carryForward) {
    insertStmt.run(item, date, defaultProject);
  }
}

export function getDailySummary(config: MemoryConfig, date: string): StoredDailySummary | null {
  const db = getDb(config);
  const row = db.prepare('SELECT * FROM daily_summary WHERE date = ?').get(date) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToStoredSummary(row);
}

export function getRecentSummaries(config: MemoryConfig, days: number = 7): StoredDailySummary[] {
  const db = getDb(config);
  const rows = db.prepare(
    'SELECT * FROM daily_summary ORDER BY date DESC LIMIT ?',
  ).all(days) as Record<string, unknown>[];
  return rows.map(rowToStoredSummary);
}

function rowToStoredSummary(row: Record<string, unknown>): StoredDailySummary {
  return {
    date: row.date as string,
    projects: JSON.parse(row.projects as string),
    summary: row.summary as string,
    carryForward: JSON.parse(row.carry_forward as string),
    stats: row.stats as string,
    workTypes: JSON.parse(row.work_types as string),
    decisions: JSON.parse(row.decisions as string),
    focus: row.focus as string | null,
    hours: row.hours as number,
    commits: row.commits as number,
    sessions: row.sessions as number,
    createdAt: row.created_at as string,
  };
}

// --- Carry Item Operations ---

export function getOpenCarryItems(config: MemoryConfig): CarryItem[] {
  const db = getDb(config);
  const rows = db.prepare(
    `SELECT * FROM carry_item WHERE status = 'open' ORDER BY origin_date ASC`,
  ).all() as Record<string, unknown>[];
  return rows.map(rowToCarryItem);
}

export function resolveCarryItem(
  config: MemoryConfig,
  id: number,
  status: 'done' | 'dropped',
  resolvedDate?: string,
): void {
  const db = getDb(config);
  db.prepare(
    `UPDATE carry_item SET status = ?, resolved_date = ? WHERE id = ?`,
  ).run(status, resolvedDate ?? new Date().toLocaleDateString('en-CA'), id);
}

export function resolveCarryItemByContent(
  config: MemoryConfig,
  content: string,
  status: 'done' | 'dropped',
  resolvedDate?: string,
): number {
  const db = getDb(config);
  const result = db.prepare(
    `UPDATE carry_item SET status = ?, resolved_date = ? WHERE content = ? AND status = 'open'`,
  ).run(status, resolvedDate ?? new Date().toLocaleDateString('en-CA'), content);
  return result.changes;
}

function rowToCarryItem(row: Record<string, unknown>): CarryItem {
  return {
    id: row.id as number,
    content: row.content as string,
    originDate: row.origin_date as string,
    status: row.status as CarryItem['status'],
    resolvedDate: row.resolved_date as string | null,
    project: row.project as string | null,
  };
}

// --- Focus Operations ---

export function setFocus(config: MemoryConfig, date: string, focus: string): void {
  const db = getDb(config);

  // Ensure daily_summary row exists
  db.prepare(`
    INSERT INTO daily_summary (date, focus)
    VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET focus = excluded.focus
  `).run(date, focus);
}

export function getFocus(config: MemoryConfig, date: string): string | null {
  const db = getDb(config);
  const row = db.prepare('SELECT focus FROM daily_summary WHERE date = ?').get(date) as { focus: string | null } | undefined;
  return row?.focus ?? null;
}

// --- Recommendations Engine ---

export interface Recommendation {
  type: 'carry_forward' | 'recent_project' | 'focus';
  priority: number; // lower = higher priority
  text: string;
  meta?: { daysOld?: number; project?: string };
}

export function getRecommendations(config: MemoryConfig, date: string): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const today = new Date(`${date}T12:00:00`);

  // 1. Open carry forward items (oldest first = highest priority)
  const openItems = getOpenCarryItems(config);
  for (const item of openItems) {
    const originD = new Date(`${item.originDate}T12:00:00`);
    const daysOld = Math.round((today.getTime() - originD.getTime()) / 86_400_000);

    // Skip items from today (they were just created)
    if (daysOld <= 0) continue;

    recommendations.push({
      type: 'carry_forward',
      priority: daysOld >= 3 ? 1 : 2,
      text: item.content,
      meta: { daysOld, project: item.project ?? undefined },
    });
  }

  // 2. Recent project context — suggest continuing recent work
  const recentSummaries = getRecentSummaries(config, 3);
  const projectFrequency = new Map<string, number>();
  for (const s of recentSummaries) {
    if (s.date === date) continue; // skip today
    for (const p of s.projects) {
      projectFrequency.set(p, (projectFrequency.get(p) ?? 0) + 1);
    }
  }

  // Top project by recent frequency
  const topProjects = [...projectFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  for (const [project] of topProjects) {
    // Find the most recent summary mentioning this project
    const latest = recentSummaries.find((s) => s.projects.includes(project) && s.date !== date);
    if (!latest) continue;

    // Extract last bullet for THIS project from summary
    // Summary format: "\n**[[project]]** #tags\n- bullet\n- bullet\n\n**[[other]]**..."
    const lines = latest.summary.split('\n');
    let inProject = false;
    let lastBullet = '';
    for (const line of lines) {
      if (line.includes(`[[${project}]]`)) {
        inProject = true;
        continue;
      }
      if (inProject && line.startsWith('**[[')) {
        break; // next project section
      }
      if (inProject && line.startsWith('- ')) {
        lastBullet = line.replace(/^- /, '');
      }
    }

    if (lastBullet) {
      recommendations.push({
        type: 'recent_project',
        priority: 5,
        text: `${project} 이어서 — ${lastBullet}`,
        meta: { project },
      });
    }
  }

  // 3. Today's focus if set
  const focus = getFocus(config, date);
  if (focus) {
    recommendations.push({
      type: 'focus',
      priority: 0, // highest priority
      text: focus,
    });
  }

  // Sort by priority (lower number = higher priority)
  recommendations.sort((a, b) => a.priority - b.priority);

  return recommendations;
}

// --- Cleanup ---

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
