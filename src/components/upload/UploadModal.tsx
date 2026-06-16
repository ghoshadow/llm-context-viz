import { useRef, useCallback, useState, type DragEvent, type ChangeEvent } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUIStore } from '../../store/uiStore';
import { SEMANTIC } from '../../styles/theme';

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'oklch(0 0 0 / 0.55)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  },
  card: {
    position: 'relative',
    width: 480,
    maxWidth: 'calc(100vw - 48px)',
    padding: '36px 32px 32px',
    borderRadius: 12,
    background: SEMANTIC.cardBg,
    border: `1px solid ${SEMANTIC.borderColor}`,
    boxShadow: '0 16px 48px oklch(0 0 0 / 0.45)',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 14,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: SEMANTIC.textMuted,
    fontSize: 20,
    lineHeight: 1,
    padding: '4px 6px',
    borderRadius: 4,
    transition: 'color 0.15s',
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: SEMANTIC.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: SEMANTIC.textSecondary,
    marginBottom: 24,
    lineHeight: 1.5,
  },
  dropZone: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    border: '2px dashed oklch(0.34 0.014 265)',
    borderRadius: 10,
    background: 'oklch(0.17 0.008 265 / 0.5)',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
    gap: 10,
  },
  dropZoneDragover: {
    borderColor: 'oklch(0.50 0.10 60)',
    background: 'oklch(0.74 0.13 60 / 0.08)',
  },
  dropIcon: {
    fontSize: 32,
    lineHeight: 1,
    opacity: 0.5,
  },
  dropText: {
    fontSize: 14,
    color: SEMANTIC.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 1.5,
  },
  dropHint: {
    fontSize: 12,
    color: SEMANTIC.textMuted,
  },
  fileBtn: {
    marginTop: 14,
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 500,
    color: SEMANTIC.textAccent2,
    background: 'oklch(0.74 0.13 60 / 0.12)',
    border: `1px solid oklch(0.50 0.10 60 / 0.4)`,
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  progressSection: {
    marginTop: 20,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 10,
  },
  progressText: {
    fontSize: 14,
    color: SEMANTIC.textSecondary,
  },
  spinner: {
    width: 28,
    height: 28,
    border: '3px solid oklch(0.30 0.014 265)',
    borderTopColor: 'oklch(0.74 0.13 60)',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
  errorSection: {
    marginTop: 20,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    fontSize: 13,
    color: 'oklch(0.67 0.18 25)',
    textAlign: 'center' as const,
    lineHeight: 1.5,
  },
  retryBtn: {
    padding: '6px 18px',
    fontSize: 13,
    fontWeight: 500,
    color: SEMANTIC.textPrimary,
    background: 'oklch(0.67 0.18 25 / 0.15)',
    border: `1px solid oklch(0.67 0.18 25 / 0.4)`,
    borderRadius: 6,
    cursor: 'pointer',
  },
};

function UploadModal() {
  const uploadOpen = useSessionStore((s) => s.uploadOpen);
  const uploading = useSessionStore((s) => s.uploading);
  const uploadProgress = useSessionStore((s) => s.uploadProgress);
  const uploadError = useSessionStore((s) => s.uploadError);
  const uploadFile = useSessionStore((s) => s.uploadFile);
  const closeUpload = useSessionStore((s) => s.closeUpload);
  const setPage = useUIStore((s) => s.setPage);
  const selectSession = useSessionStore((s) => s.selectSession);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [retryFile, setRetryFile] = useState<File | null>(null);

  const handleUpload = useCallback(
    async (file: File) => {
      setRetryFile(file);
      const sessionId = await uploadFile(file);
      if (sessionId) {
        setPage('assembly');
        await selectSession(sessionId);
      }
    },
    [uploadFile, setPage, selectSession],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file && (file.name.endsWith('.jsonl') || file.name.endsWith('.json'))) {
          handleUpload(file);
        }
      }
    },
    [handleUpload],
  );

  const onFileSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleUpload(file);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [handleUpload],
  );

  const onRetry = useCallback(() => {
    if (retryFile) {
      handleUpload(retryFile);
    }
  }, [retryFile, handleUpload]);

  const onOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget && !uploading) {
        closeUpload();
      }
    },
    [uploading, closeUpload],
  );

  if (!uploadOpen) return null;

  return (
    <div style={styles.overlay} onClick={onOverlayClick}>
      <div style={styles.card}>
        <button
          style={styles.closeBtn}
          onClick={closeUpload}
          disabled={uploading}
          title="关闭"
        >
          ✕
        </button>

        <h2 style={styles.title}>上传新会话</h2>
        <p style={styles.subtitle}>
          导入 Claude Code 会话导出的 JSONL 文件，生成可视化上下文分析报告。
        </p>

        {!uploading && !uploadError && (
          <>
            <div
              style={{
                ...styles.dropZone,
                ...(isDragOver ? styles.dropZoneDragover : {}),
              }}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <span style={styles.dropIcon}>
                {isDragOver ? '📂' : '📁'}
              </span>
              <span style={styles.dropText}>
                {isDragOver ? '松开以上传文件' : '拖拽 JSONL 文件到此处'}
              </span>
              <span style={styles.dropHint}>支持 .jsonl / .json 格式</span>
            </div>

            <div style={{ textAlign: 'center' as const }}>
              <button
                style={styles.fileBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                选择文件
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl,.json"
              style={{ display: 'none' }}
              onChange={onFileSelect}
            />
          </>
        )}

        {uploading && (
          <div style={styles.progressSection}>
            <div style={styles.spinner} />
            <span style={styles.progressText}>
              {uploadProgress || '正在上传解析…'}
            </span>
          </div>
        )}

        {uploadError && !uploading && (
          <div style={styles.errorSection}>
            <span style={styles.errorText}>{uploadError}</span>
            <button style={styles.retryBtn} onClick={onRetry}>
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadModal;
