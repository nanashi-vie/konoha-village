import { describe, it, expect } from 'vitest';
import { parsePlan } from '../../src/plan/parse.js';

const PATH = 'docs/superpowers/plans/2026-11-23-gui-email.md';
const PLAN = `# Gửi email Implementation Plan
**Trạng thái plan:** đã duyệt

## Thư viện cần thêm
- \`npm install nodemailer@6.9.14\`

### Task 1: Tạo bảng dữ liệu
**Giao cho:** agy / gemini-4-hydrogen-low
**Chờ:** —
**Files:**
- Create: \`src/db/schema.ts\`
- Modify: \`src/app.ts:10-20\`
...nội dung việc...

### Task 2: Viết API
**Giao cho:** claude / sonnet
**Chờ:** 1
`;

describe('parsePlan', () => {
  it('parses approved flag', () => {
    expect(parsePlan(PLAN, PATH).approved).toBe(true);
    expect(parsePlan(PLAN.replace('**Trạng thái plan:** đã duyệt\n', ''), PATH).approved).toBe(false);
    expect(parsePlan(PLAN.replace('đã duyệt', 'nháp'), PATH).approved).toBe(false);
  });
  it('parses slug from filename', () => {
    expect(parsePlan(PLAN, PATH).slug).toBe('gui-email');
  });
  it('parses libraries', () => {
    expect(parsePlan(PLAN, PATH).libraries).toEqual(['npm install nodemailer@6.9.14']);
  });
  it('parses tasks', () => {
    const p = parsePlan(PLAN, PATH);
    expect(p.tasks).toHaveLength(2);
    expect(p.tasks[0]).toMatchObject({
      id: 1, name: 'Tạo bảng dữ liệu', tool: 'agy', model: 'gemini-4-hydrogen-low',
      waitsOn: [], files: ['src/db/schema.ts', 'src/app.ts'],
    });
    expect(p.tasks[1]).toMatchObject({ tool: 'claude', model: 'sonnet', waitsOn: [1] });
  });
  it('tool without model', () => {
    const p = parsePlan(PLAN.replace('agy / gemini-4-hydrogen-low', 'agy'), PATH);
    expect(p.tasks[0].tool).toBe('agy');
    expect(p.tasks[0].model).toBeNull();
  });
  it('body is task text', () => {
    const p = parsePlan(PLAN, PATH);
    expect(p.tasks[0].body).toContain('...nội dung việc...');
    expect(p.tasks[0].body).not.toContain('### Task 2');
  });
});
