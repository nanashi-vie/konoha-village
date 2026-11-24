import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Config {
  maxParallel: number;
  maxReviewRetries: number;
  workerTimeoutMinutes: number;
  testCommand: string;
  setupCommand: string | null;
  reviewModel: string;
  baseBranch: string;
  integrationBranch: string;
}

export const DEFAULT_CONFIG: Omit<Config, 'testCommand'> = {
  maxParallel: 3,
  maxReviewRetries: 2,
  workerTimeoutMinutes: 30,
  setupCommand: null,
  reviewModel: 'opus',
  baseBranch: 'main',
  integrationBranch: 'dev',
};

export interface Policy {
  allowCommands: string[];
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

export function loadConfig(repoRoot: string): Config {
  const raw = readJson(join(repoRoot, '.konoha', 'config.json'));
  if (!raw || typeof raw.testCommand !== 'string' || raw.testCommand === '') {
    throw new Error('Thiếu "testCommand" trong .konoha/config.json');
  }
  return { ...DEFAULT_CONFIG, ...raw, testCommand: raw.testCommand } as Config;
}

export function loadPolicy(repoRoot: string, config: Config): Policy {
  const raw = readJson(join(repoRoot, '.konoha', 'permissions.json'));
  const allow = raw?.allowCommands;
  if (Array.isArray(allow) && allow.every((x) => typeof x === 'string')) {
    return { allowCommands: allow as string[] };
  }
  return { allowCommands: [config.testCommand] };
}
