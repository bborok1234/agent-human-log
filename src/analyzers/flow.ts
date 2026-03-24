import type { SessionEntry, TimeBlock } from '../types/index.js';

// --- Flow Types ---

export type FlowType = 'investigation' | 'implementation' | 'refactoring' | 'verification' | 'ops';

export interface SessionFlow {
  sessionId: string;
  project: string;
  distribution: Record<FlowType, number>; // percentage 0-100
  dominant: FlowType;
  toolCount: number;
}

// --- Pattern Matching ---

/** Tool categories for flow classification */
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Agent']);
const EDIT_TOOLS = new Set(['Edit', 'Write']);
const VERIFY_TOOLS = new Set(['Bash']); // context-dependent

/** Classify a sliding window of 2-3 consecutive tool calls */
function classifyWindow(tools: string[]): FlowType {
  const pattern = tools.join('→');

  // Investigation: reading/searching without editing
  if (tools.every((t) => READ_TOOLS.has(t))) return 'investigation';

  // Implementation: read → edit → verify cycle
  if (
    tools.length >= 2 &&
    READ_TOOLS.has(tools[0]) &&
    EDIT_TOOLS.has(tools[tools.length - 1])
  ) return 'implementation';

  if (
    tools.length >= 2 &&
    EDIT_TOOLS.has(tools[0]) &&
    tools[tools.length - 1] === 'Bash'
  ) return 'verification';

  // Refactoring: consecutive edits
  if (tools.length >= 2 && tools.every((t) => EDIT_TOOLS.has(t))) return 'refactoring';

  // Read → Edit is basic implementation
  if (tools.some((t) => READ_TOOLS.has(t)) && tools.some((t) => EDIT_TOOLS.has(t))) return 'implementation';

  // Bash-heavy = ops or verification
  if (tools.every((t) => t === 'Bash')) return 'ops';

  // Default based on what's most present
  if (tools.some((t) => EDIT_TOOLS.has(t))) return 'implementation';
  if (tools.some((t) => READ_TOOLS.has(t))) return 'investigation';

  return 'ops';
}

// --- Session Flow Analysis ---

/**
 * Analyze a session's tool sequence and classify into flow types.
 * Uses a sliding window of size 3 over the tool sequence.
 */
export function analyzeSessionFlow(session: SessionEntry): SessionFlow {
  const seq = session.toolSequence;
  const counts: Record<FlowType, number> = {
    investigation: 0,
    implementation: 0,
    refactoring: 0,
    verification: 0,
    ops: 0,
  };

  if (seq.length === 0) {
    return {
      sessionId: session.sessionId,
      project: session.project,
      distribution: { investigation: 0, implementation: 0, refactoring: 0, verification: 0, ops: 0 },
      dominant: 'implementation',
      toolCount: 0,
    };
  }

  // Sliding window of size 3 (or smaller for short sequences)
  const windowSize = Math.min(3, seq.length);
  for (let i = 0; i <= seq.length - windowSize; i++) {
    const window = seq.slice(i, i + windowSize);
    const flow = classifyWindow(window);
    counts[flow]++;
  }

  // Handle edge case: single tool
  if (seq.length === 1) {
    const flow = classifyWindow(seq);
    counts[flow] = 1;
  }

  // Convert to percentages
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  const distribution: Record<FlowType, number> = {
    investigation: 0,
    implementation: 0,
    refactoring: 0,
    verification: 0,
    ops: 0,
  };

  for (const [key, value] of Object.entries(counts)) {
    distribution[key as FlowType] = total > 0 ? Math.round((value / total) * 100) : 0;
  }

  // Find dominant flow
  const dominant = (Object.entries(distribution) as [FlowType, number][])
    .sort((a, b) => b[1] - a[1])[0][0];

  return {
    sessionId: session.sessionId,
    project: session.project,
    distribution,
    dominant,
    toolCount: seq.length,
  };
}

// --- Aggregate Flow Distribution ---

/**
 * Merge flow distributions from multiple sessions into a single day-level distribution.
 * Weighted by tool count so longer sessions have more influence.
 */
export function aggregateFlowDistribution(
  sessions: SessionEntry[],
): Record<string, number> {
  const weightedCounts: Record<FlowType, number> = {
    investigation: 0,
    implementation: 0,
    refactoring: 0,
    verification: 0,
    ops: 0,
  };

  let totalTools = 0;

  for (const session of sessions) {
    const flow = analyzeSessionFlow(session);
    for (const [type, pct] of Object.entries(flow.distribution)) {
      weightedCounts[type as FlowType] += (pct / 100) * flow.toolCount;
    }
    totalTools += flow.toolCount;
  }

  const result: Record<string, number> = {};
  for (const [type, weighted] of Object.entries(weightedCounts)) {
    const pct = totalTools > 0 ? Math.round((weighted / totalTools) * 100) : 0;
    if (pct > 0) result[type] = pct;
  }

  return result;
}

// --- Time Blocks ---

/**
 * Extract time blocks from sessions showing when each project was worked on.
 */
export function extractTimeBlocks(sessions: SessionEntry[]): TimeBlock[] {
  return sessions
    .filter((s) => s.durationMinutes > 0)
    .map((s) => {
      const start = s.timestamp;
      const end = new Date(start.getTime() + s.durationMinutes * 60_000);

      return {
        start: formatTime(start),
        end: formatTime(end),
        project: s.project.split('/').pop() ?? s.project,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
