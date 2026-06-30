import { getSessionCardTitleDisplay, type SessionCardTitleDisplay } from '../home/sessionTitle';

export type ScannerFileTitleDisplay = SessionCardTitleDisplay;

export function getScannerFileTitleDisplay(
  title: string | null | undefined,
  filename: string | null | undefined,
): ScannerFileTitleDisplay {
  return getSessionCardTitleDisplay(title, filename);
}
