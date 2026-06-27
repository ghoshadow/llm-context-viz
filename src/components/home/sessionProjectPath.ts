export function getSessionProjectPathText(session: { cwd?: string | null }): string {
  const cwd = session.cwd?.trim();
  if (!cwd) return '未记录项目目录';

  if (cwd === '/Users/link') return '~';
  return cwd.startsWith('/Users/link/') ? `~/${cwd.slice('/Users/link/'.length)}` : cwd;
}
