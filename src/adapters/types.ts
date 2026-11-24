import type { Policy } from '../config.js';

export interface WorkerJob {
  worktree: string;
  prompt: string;
  model: string | null;
  policy: Policy;
  mode: 'work' | 'review';
}

export interface Invocation {
  cmd: string;
  args: string[];
  env: Record<string, string>;
}

export interface Adapter {
  tool: string;
  binary: string;
  isolation: 'trusted' | 'verify';
  hash: string;
  maxParallel: number | null;
  hasMode(mode: 'work' | 'review'): boolean;
  /** Throws if the tool has no such mode or the command would contain a forbidden flag. */
  build(job: WorkerJob): Invocation;
  /** null when the real model cannot be read from the output. */
  actualModel(stdout: string): string | null;
}

export const FORBIDDEN_FLAGS: string[] = [
  '--dangerously-skip-permissions',
  '--yolo',
  '-y',
  '--dangerously-bypass-approvals-and-sandbox',
  '--full-auto',
  '--approval-mode yolo',
];
