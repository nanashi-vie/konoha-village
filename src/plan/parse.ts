export interface PlanTask {
  id: number;
  name: string;
  tool: string;
  model: string | null;
  waitsOn: number[];
  files: string[];
  body: string;
}

export interface Plan {
  path: string;
  slug: string;
  title: string;
  approved: boolean;
  libraries: string[];
  tasks: PlanTask[];
}

function slugFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function parseAssignee(value: string): { tool: string; model: string | null } {
  const [tool, ...rest] = value.split('/');
  const model = rest.join('/').trim();
  return { tool: (tool ?? '').trim(), model: model === '' ? null : model };
}

function parseWaits(value: string): number[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

function parseFiles(body: string): string[] {
  const files: string[] = [];
  for (const m of body.matchAll(/^\s*-\s*(?:Create|Modify|Test):\s*`([^`]+)`/gm)) {
    files.push(m[1].replace(/:\d+(?:-\d+)?$/, ''));
  }
  return files;
}

export function parsePlan(markdown: string, path: string): Plan {
  const title = /^#\s+(.+?)(?:\s+Implementation Plan)?\s*$/m.exec(markdown)?.[1] ?? '';
  const status = /^\*\*Trạng thái plan:\*\*\s*(.+)$/m.exec(markdown)?.[1].trim();
  const approved = status === 'đã duyệt';

  const libraries: string[] = [];
  const libSection = /^## Thư viện cần thêm\s*\n([\s\S]*?)(?=^#{1,3} |\s*$(?![\s\S]))/m.exec(markdown);
  if (libSection) {
    for (const m of libSection[1].matchAll(/^\s*-\s*`([^`]+)`/gm)) libraries.push(m[1]);
  }

  const tasks: PlanTask[] = [];
  const parts = markdown.split(/^(?=### Task \d+:)/m).filter((s) => /^### Task \d+:/.test(s));
  for (const part of parts) {
    const head = /^### Task (\d+):\s*(.+)$/m.exec(part)!;
    const assignee = /^\*\*Giao cho:\*\*\s*(.+)$/m.exec(part)?.[1] ?? '';
    const waits = /^\*\*Chờ:\*\*\s*(.+)$/m.exec(part)?.[1] ?? '';
    tasks.push({
      id: Number(head[1]),
      name: head[2].trim(),
      ...parseAssignee(assignee),
      waitsOn: parseWaits(waits),
      files: parseFiles(part),
      body: part.trimEnd(),
    });
  }
  return { path, slug: slugFromPath(path), title, approved, libraries, tasks };
}
