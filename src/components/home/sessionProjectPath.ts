import { homedir } from 'os';

export function getSessionProjectPathText(session: { cwd?: string | null }): string {
  const cwd = session.cwd?.trim();
  if (!cwd) return '未记录项目目录';

  const home = homedir();
  if (cwd === home) return '~';
  return cwd.startsWith(home + '/') ? `~/${cwd.slice(home.length + 1)}` : cwd;
}
