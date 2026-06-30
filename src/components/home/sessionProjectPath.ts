export function getSessionProjectPathText(session: { cwd?: string | null }, homeDir?: string | null): string {
  const cwd = session.cwd?.trim();
  if (!cwd) return '未记录项目目录';

  const home = homeDir || '';
  if (!home) return cwd;
  if (cwd === home) return '~';
  return cwd.startsWith(home + '/') ? `~/${cwd.slice(home.length + 1)}` : cwd;
}
