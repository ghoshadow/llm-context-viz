import { SESSION_SOURCE_LABELS } from '../../utils/sessionSource';

export type ScannerFileSource = 'claude' | 'codex' | 'opencode' | 'pi' | 'openclaw';

export const SCANNER_SOURCE_LABELS: Record<ScannerFileSource, string> = {
  claude: SESSION_SOURCE_LABELS.claude,
  codex: SESSION_SOURCE_LABELS.codex,
  opencode: SESSION_SOURCE_LABELS.opencode,
  pi: SESSION_SOURCE_LABELS.pi,
  openclaw: SESSION_SOURCE_LABELS.openclaw,
};

export const SCANNER_SOURCES = Object.keys(SCANNER_SOURCE_LABELS) as ScannerFileSource[];

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
    if (file.source !== options.source) return false;

    if (!options.hideShortSessions) return true;
    if (file.turnCount == null) return true;
    return file.turnCount >= 5;
  });
}
