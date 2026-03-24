// --- Config ---

export interface Config {
  obsidian: ObsidianConfig;
  git: GitConfig;
  session: SessionConfig;
  summarizer: SummarizerConfig;
  memory: MemoryConfig;
}

export interface MemoryConfig {
  /** Path to SQLite database file */
  dbPath: string;
}

export interface ObsidianConfig {
  vaultPath: string;
  dailyNotesDir: string;
  dateFormat: string;
}

export interface GitConfig {
  repos: string[];
  authorEmail: string;
}

export interface SessionConfig {
  claudeCodeDir: string;
  openCodeDb: string;
}

export interface SummarizerConfig {
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  maxTokens: number;
}

// --- Session Analyzer ---

export interface SessionEntry {
  sessionId: string;
  timestamp: Date;
  project: string;
  userMessages: string[];
  agentsUsed: string[];
  messageCount: number;
  completedTodos: string[];
  /** Pending/in-progress todos from the session */
  pendingTodos: string[];
  /** Estimated from first/last message timestamps */
  durationMinutes: number;
  /** Files modified via Edit/Write tools during session */
  filesEdited: string[];
  /** Meaningful commands run via Bash tool (test, build, deploy, git) */
  commandsRun: string[];
  /** Tool invocation counts by tool name */
  toolUseCounts: Record<string, number>;
}

// --- Git Analyzer ---

export interface GitCommit {
  hash: string;
  message: string;
  timestamp: Date;
  repo: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface GitDaySummary {
  repo: string;
  commits: GitCommit[];
  totalFilesChanged: number;
  totalInsertions: number;
  totalDeletions: number;
  activeBranches: string[];
}

// --- Summarizer ---

export interface DayData {
  date: string; // YYYY-MM-DD
  sessions: SessionEntry[];
  git: GitDaySummary[];
}

export interface DailySummary {
  date: string;
  /** 3-5 line compressed summary of the day's work */
  summary: string[];
  carryForward: string[];
  /** Stats line: "N commits · N files · +N/-N · N sessions · ~Nh" */
  stats: string;
  /** Projects involved in this day's work */
  projects: string[];
  /** Classified work types: bugfix, feature, refactor, investigation, ops, docs */
  workTypes: string[];
  /** Key decisions made during the day */
  decisions: DecisionRecord[];
  /** Aggregated list of files edited across all sessions */
  filesEdited: string[];
  /** Total hours worked */
  hours: number;
  /** Total commits */
  commits: number;
  /** Total sessions */
  sessions: number;
}

export interface DecisionRecord {
  title: string;
  rationale: string;
  tradeoff?: string;
}

// --- Obsidian Writer ---

export interface DailyNote {
  filePath: string;
  sections: {
    focus?: string;
    summary?: string;
    workLog?: string[];
    carryForward?: string[];
    stats?: string;
  };
}

// --- MCP Tool Results ---

export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}
