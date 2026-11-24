import { execSync } from 'node:child_process';
import { commitAll } from './git.js';

export function installLibraries(integrationWt: string, commands: string[]): void {
  if (commands.length === 0) return;
  for (const cmd of commands) {
    try {
      execSync(cmd, { cwd: integrationWt, stdio: 'pipe', timeout: 600_000 });
    } catch (err) {
      const stderr = String((err as { stderr?: Buffer }).stderr ?? '').trim();
      throw new Error(`Lệnh cài thư viện hỏng: ${cmd}${stderr ? ` — ${stderr.slice(0, 300)}` : ''}`);
    }
  }
  commitAll(integrationWt, 'chore: add libraries required by plan', []);
}
