import { useState, useCallback, useEffect, useRef } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import { SEMANTIC } from '../../styles/theme';
import { fmtK } from '../../utils/format';

interface FoundFile {
  path: string;
  name: string;
  size: number;
  modified: string;
  hash: string;
  imported: boolean;
  title?: string;
  model?: string;
  requests?: number;
  peakTokens?: number;
  turnCount?: number;
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'oklch(0 0 0 / 0.55)', backdropFilter: 'blur(6px)',
  } as React.CSSProperties,
  card: {
    width: 560, maxWidth: 'calc(100vw - 48px)', maxHeight: '80vh',
    padding: '28px 28px 20px', borderRadius: 12,
    background: SEMANTIC.cardBg, border: `1px solid ${SEMANTIC.borderColor}`,
    boxShadow: '0 16px 48px oklch(0 0 0 / 0.45)',
    display: 'flex', flexDirection: 'column',
  } as React.CSSProperties,
  closeBtn: {
    position: 'absolute', top: 12, right: 14,
    background: 'none', border: 'none', cursor: 'pointer',
    color: SEMANTIC.textMuted, fontSize: 20, lineHeight: 1, padding: '4px 6px', borderRadius: 4,
  } as React.CSSProperties,
  title: { margin: 0, fontSize: 18, fontWeight: 600, color: SEMANTIC.textPrimary } as React.CSSProperties,
  scanBtn: {
    marginTop: 16, padding: '10px 20px', fontSize: 13, fontWeight: 500,
    color: SEMANTIC.textAccent2, background: 'oklch(0.74 0.13 60 / 0.12)',
    border: `1px solid oklch(0.50 0.10 60 / 0.4)`, borderRadius: 6, cursor: 'pointer',
    alignSelf: 'center',
  } as React.CSSProperties,
  list: {
    marginTop: 16, overflowY: 'auto', flex: 1,
    display: 'flex', flexDirection: 'column', gap: 6,
  } as React.CSSProperties,
  fileItem: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
    borderRadius: 8, border: `1px solid ${SEMANTIC.borderColor}`,
    background: 'oklch(0.18 0.008 265 / 0.5)',
  } as React.CSSProperties,
  fileName: { flex: 1, fontSize: 12.5, color: SEMANTIC.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
  meta: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: SEMANTIC.textMuted, whiteSpace: 'nowrap' } as React.CSSProperties,
  importBtn: {
    padding: '5px 14px', fontSize: 11.5, fontWeight: 500, borderRadius: 5,
    background: 'oklch(0.74 0.13 60 / 0.15)', color: SEMANTIC.textAccent2,
    border: `1px solid oklch(0.50 0.10 60 / 0.35)`, cursor: 'pointer',
  } as React.CSSProperties,
  importedTag: {
    padding: '4px 10px', fontSize: 11, borderRadius: 5,
    background: 'oklch(0.26 0.01 265)', color: SEMANTIC.textMuted,
    border: `1px solid ${SEMANTIC.borderColor}`,
  } as React.CSSProperties,
  spinner: {
    width: 24, height: 24, border: '3px solid oklch(0.30 0.014 265)',
    borderTopColor: 'oklch(0.74 0.13 60)', borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  } as React.CSSProperties,
  status: { textAlign: 'center', fontSize: 13, color: SEMANTIC.textSecondary, marginTop: 12 } as React.CSSProperties,
};

export default function ScannerModal() {
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  const files = useSessionStore(s => s.scanFiles);
  const status = useSessionStore(s => s.scanStatus);
  const closeScanner = useSessionStore(s => s.closeScanner);
  const setScanFiles = useSessionStore(s => s.setScanFiles);
  const closeScanner = useSessionStore(s => s.closeScanner);
  const fetchSessions = useSessionStore(s => s.fetchSessions);
  const setPage = useUIStore(s => s.setPage);
  const selectSession = useSessionStore(s => s.selectSession);

  const hasScanned = useRef(false);

  const doScan = useCallback(async (force?: boolean) => {
    setScanning(true);
    setScanFiles(files, '正在扫描本地会话目录…');
    try {
      const url = force ? '/api/scanner/scan?force=1' : '/api/scanner/scan';
      const resp = await fetch(url);
      const data = await resp.json();
      const cachedNote = data.cached > 0 ? `（${data.cached} 个命中缓存）` : '';
      setScanFiles(data.files || [], `发现 ${data.totalFiles} 个文件，其中 ${data.importedCount} 个已导入${cachedNote}`);
    } catch (e) {
      setScanFiles(files, '扫描失败: ' + (e as Error).message);
    } finally {
      setScanning(false);
    }
  }, [setScanFiles, files]);

  // Auto-load every time the modal opens
  useEffect(() => {
    doScan();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doImport = useCallback(async (file: FoundFile) => {
    setImporting(file.path);
    try {
      const resp = await fetch('/api/scanner/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path }),
      });
      const data = await resp.json();
      if (data.imported || data.sessionId) {
        closeScanner();
        await fetchSessions();
        setPage('inspector');
        await selectSession(data.sessionId);
      }
    } catch (e) {
      setScanFiles(files, '导入失败: ' + (e as Error).message);
    } finally {
      setImporting(null);
    }
  }, [fetchSessions, setPage, selectSession, files, status, setScanFiles]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  return (
    <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) closeScanner(); }}>
      <div style={{ ...S.card, position: 'relative' } as React.CSSProperties}>
        <button style={S.closeBtn} onClick={closeScanner} title="关闭">✕</button>

        <h2 style={S.title}>扫描本地会话</h2>

        {files.length === 0 && !scanning && (
          <p style={{ fontSize: 13, color: SEMANTIC.textSecondary, marginTop: 8, textAlign: 'center' }}>
            扫描 Claude Code 项目目录下的 JSONL 会话记录
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }}>
          <button style={S.scanBtn} onClick={() => doScan(false)} disabled={scanning}>
            {scanning ? '扫描中…' : '🔍 扫描本地会话'}
          </button>
          {files.length > 0 && (
            <span
              style={{ fontSize: 11, color: SEMANTIC.textMuted, cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => doScan(true)}
            >
              强制重新扫描
            </span>
          )}
        </div>

        {status && <div style={S.status}>{status}</div>}

        {scanning && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <div style={S.spinner} />
          </div>
        )}

        {files.length > 0 && (
          <div className="tl" style={S.list}>
            {files.map((f) => (
              <div key={f.path} style={S.fileItem}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.fileName} title={f.path}>{f.title || f.name}</div>
                  {f.title && <div style={{ fontSize: 10, color: SEMANTIC.textMuted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>{f.name}</div>}
                  {!f.imported && f.requests != null && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                      <span style={{ fontSize: 11, color: SEMANTIC.textMuted }}>{f.model || 'unknown'}</span>
                      <span style={{ fontSize: 11, color: SEMANTIC.textMuted }}>{f.requests} 请求</span>
                      <span style={{ fontSize: 11, color: 'oklch(0.74 0.13 60)' }}>峰值 {fmtK(f.peakTokens ?? 0)}</span>
                      <span style={{ fontSize: 11, color: SEMANTIC.textMuted }}>{f.turnCount} 轮</span>
                    </div>
                  )}
                </div>
                <span style={S.meta}>{fmtK(f.size)}B</span>
                <span style={S.meta}>{formatDate(f.modified)}</span>
                {f.imported ? (
                  <span style={S.importedTag}>已导入</span>
                ) : (
                  <button
                    style={S.importBtn}
                    disabled={importing === f.path}
                    onClick={() => doImport(f)}
                  >
                    {importing === f.path ? '导入中…' : '导入'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
