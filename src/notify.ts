import { execFileSync } from 'node:child_process';

const defaultRun = (cmd: string, args: string[]): void => {
  execFileSync(cmd, args, { stdio: 'ignore' });
};

const escapeAppleScript = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function notifyUser(title: string, message: string, run: (cmd: string, args: string[]) => void = defaultRun): void {
  console.log(`[${title}] ${message}`);
  try {
    run('osascript', ['-e', `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`]);
  } catch {
    // notification is best effort; the stdout line above is the record
  }
}
