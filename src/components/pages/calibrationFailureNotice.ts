interface CalibrationFailureInput {
  cwd?: string;
  error?: string | null;
  output?: string[];
}

export interface CalibrationFailureNotice {
  title: string;
  detail: string;
  command?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function traceDirFromText(text: string): string | null {
  const direct = text.match(/Project trace directory is not writable:\s+(.+?)(?:\s+\(|$)/);
  if (direct?.[1]) return direct[1].trim();

  const access = text.match(/EACCES: permission denied, access '([^']+\.claude-trace)'/);
  if (access?.[1]) return access[1].trim();

  return null;
}

export function getCalibrationFailureNotice(job: CalibrationFailureInput | null): CalibrationFailureNotice | null {
  if (!job) return null;
  const text = [job.error, ...(job.output ?? [])].filter(Boolean).join('\n');
  if (!/Project trace directory is not writable|EACCES: permission denied/.test(text)) return null;

  const traceDir = traceDirFromText(text) ?? (job.cwd ? `${job.cwd.replace(/\/$/, '')}/.claude-trace` : null);
  if (!traceDir) {
    return {
      title: '项目日志目录没有写入权限',
      detail: '自动校准需要写入当前项目的 .claude-trace 目录，请把该目录权限交还给当前用户后重试。',
    };
  }

  return {
    title: '项目日志目录没有写入权限',
    detail: `自动校准需要写入 ${traceDir}。当前进程没有写权限，请在终端执行下面的命令后重试。`,
    command: `sudo chown -R "$USER":staff ${shellQuote(traceDir)}`,
  };
}
