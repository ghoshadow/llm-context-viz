export type ScannerFileSource = 'claude' | 'codex';

export interface ScannerFileFilterItem {
  source?: ScannerFileSource;
  turnCount?: number;
}

export interface ScannerFileFilterOptions {
  source: ScannerFileSource;
  hideShortSessions: boolean;
}

export function filterScannerFiles<T extends ScannerFileFilterItem>(
  files: T[],
  options: ScannerFileFilterOptions,
): T[] {
  return files.filter((file) => {
    const matchesSource = options.source === 'codex'
      ? file.source === 'codex'
      : file.source !== 'codex';
    if (!matchesSource) return false;

    if (!options.hideShortSessions) return true;
    if (file.turnCount == null) return true;
    return file.turnCount >= 5;
  });
}
