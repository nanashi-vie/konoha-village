import type { Plan } from './plan/parse.js';
import type { RunState } from './state/store.js';

export function nextRunnable(
  plan: Plan,
  state: RunState,
  maxParallel: number,
  toolLimits: Record<string, number> = {},
): number[] {
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const running = plan.tasks.filter((t) => state.tasks[t.id]?.status === 'running');
  const busyFiles = new Set(running.flatMap((t) => t.files));
  const toolCount = new Map<string, number>();
  for (const t of running) toolCount.set(t.tool, (toolCount.get(t.tool) ?? 0) + 1);

  let slots = maxParallel - running.length;
  const picked: number[] = [];
  const sorted = [...plan.tasks].sort((a, b) => a.id - b.id);
  for (const t of sorted) {
    if (slots <= 0) break;
    if (state.tasks[t.id]?.status !== 'pending') continue;
    if (!t.waitsOn.every((w) => byId.has(w) && state.tasks[w]?.status === 'merged')) continue;
    if (t.files.some((f) => busyFiles.has(f))) continue;
    const limit = toolLimits[t.tool];
    if (limit !== undefined && (toolCount.get(t.tool) ?? 0) >= limit) continue;
    picked.push(t.id);
    slots--;
    t.files.forEach((f) => busyFiles.add(f));
    toolCount.set(t.tool, (toolCount.get(t.tool) ?? 0) + 1);
  }
  return picked;
}
