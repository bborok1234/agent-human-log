import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitCommit, GitDaySummary } from '../types/index.js';

const execFileAsync = promisify(execFile);
const GIT_BINARY = process.env['GIT_PATH'] ?? '/usr/bin/git';

const COMMIT_START = '---AHL_COMMIT_START---';
const GIT_LOG_FORMAT = `${COMMIT_START}%n%H%n%s%n%aI`;

export async function getGitSummaryForDate(
  repos: string[],
  date: string,
  authorEmail: string,
): Promise<GitDaySummary[]> {
  const summaries: GitDaySummary[] = [];

  for (const repo of repos) {
    const summary = await getRepoSummary(repo, date, authorEmail);
    if (summary) {
      summaries.push(summary);
    }
  }

  return summaries;
}

async function getRepoSummary(
  repoPath: string,
  date: string,
  authorEmail: string,
): Promise<GitDaySummary | null> {
  const resolvedPath = repoPath.replace(/^~/, process.env['HOME'] ?? '');
  const repoName = resolvedPath.split('/').pop() ?? 'unknown';

  try {
    const commits = await getCommitsForDate(resolvedPath, date, authorEmail);
    if (commits.length === 0) return null;

    const branches = await getActiveBranches(resolvedPath);

    let totalFilesChanged = 0;
    let totalInsertions = 0;
    let totalDeletions = 0;

    for (const commit of commits) {
      totalFilesChanged += commit.filesChanged;
      totalInsertions += commit.insertions;
      totalDeletions += commit.deletions;
    }

    return {
      repo: repoName,
      commits,
      totalFilesChanged,
      totalInsertions,
      totalDeletions,
      activeBranches: branches,
    };
  } catch (error) {
    console.error(`Failed to read git repo ${repoPath}:`, error);
    return null;
  }
}

async function getCommitsForDate(
  repoPath: string,
  date: string,
  authorEmail: string,
): Promise<GitCommit[]> {
  const repoName = repoPath.split('/').pop() ?? 'unknown';

  const { stdout } = await execFileAsync(GIT_BINARY, [
    'log',
    `--since=${date}T00:00:00`,
    `--until=${date}T23:59:59`,
    `--author=${authorEmail}`,
    `--format=${GIT_LOG_FORMAT}`,
    '--stat',
    '--all',
  ], { cwd: repoPath });

  if (!stdout.trim()) return [];

  return parseGitLogOutput(stdout, repoName);
}

function parseGitLogOutput(output: string, repoName: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const blocks = output.split(COMMIT_START).filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const hash = lines[0];
    const message = lines[1];
    const dateStr = lines[2];
    const timestamp = new Date(dateStr);

    if (!hash || hash.length !== 40) continue;

    const statLine = lines.find((l) => /\d+ files? changed/.test(l));

    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    if (statLine) {
      const filesMatch = statLine.match(/(\d+) files? changed/);
      const insertMatch = statLine.match(/(\d+) insertions?\(\+\)/);
      const deleteMatch = statLine.match(/(\d+) deletions?\(-\)/);

      filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : 0;
      insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;
      deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;
    }

    commits.push({
      hash,
      message,
      timestamp,
      repo: repoName,
      filesChanged,
      insertions,
      deletions,
    });
  }

  return commits;
}

async function getActiveBranches(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(GIT_BINARY, [
      'branch',
      '--sort=-committerdate',
      '--format=%(refname:short)',
    ], { cwd: repoPath });

    return stdout
      .split('\n')
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    return [];
  }
}
