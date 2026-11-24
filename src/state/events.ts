import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDir } from './store.js';

export type EventType =
  | 'run_started' | 'libraries_installed' | 'task_started' | 'worker_finished'
  | 'review_passed' | 'review_failed' | 'task_merged' | 'task_blocked' | 'run_awaiting_merge'
  | 'run_needs_user' | 'run_merged_to_dev' | 'tool_overridden';

export interface KonohaEvent {
  ts: string;
  run: string;
  type: EventType;
  taskId: number | null;
  role: 'program' | 'worker' | 'judge';
  tool: string | null;
  modelRequested: string | null;
  model: string | null;
  summary: string;
}

function logFile(repoRoot: string, slug: string): string {
  return join(runDir(repoRoot, slug), 'events.jsonl');
}

export function appendEvent(repoRoot: string, e: Omit<KonohaEvent, 'ts'>): void {
  mkdirSync(runDir(repoRoot, e.run), { recursive: true });
  const event: KonohaEvent = { ts: new Date().toISOString(), ...e };
  appendFileSync(logFile(repoRoot, e.run), JSON.stringify(event) + '\n');
}

export function readEvents(repoRoot: string, slug: string): KonohaEvent[] {
  const file = logFile(repoRoot, slug);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as KonohaEvent);
}
