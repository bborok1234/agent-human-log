// --- Config ---

export interface Config {
  obsidian: ObsidianConfig;
  git: GitConfig;
  session: SessionConfig;
  summarizer: SummarizerConfig;
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
  /** Estimated from first/last message timestamps */
  durationMinutes: number;
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
