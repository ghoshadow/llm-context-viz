import { useState, useCallback, useEffect } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSessionStore } from '../../store/sessionStore';
import { post, put, get } from '../../api/client';
import { SEMANTIC } from '../../styles/theme';
import { fmt } from '../../utils/format';
import { CHARS_PER_TOKEN } from '../../pipeline/utils';
import { getCalibrationFailureNotice } from './calibrationFailureNotice';
import { MarkdownBlock } from '../shared/MarkdownBlock';
import { getCalibrationDetailLayout, getCalibrationDetailSectionIndex } from './calibrationDetailModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemBlocks {
  total: number;
  billing: number;
  agentIdentity: number;
  harness: number;
}

interface UserMessageParts {
  total: number;
  chrome: number;
  globalClaudeMd: number;
  projectClaudeMd: number;
  mcpInstructions: number;
  skillsListing: number;
  currentDate: number;
  sessionGuidance: number;
}

interface ExtractedResult {
  sourceFile: string;
  ccVersion: string;
  model: string;
  systemBlocks: SystemBlocks;
  toolsChars: number;
  userMessage: UserMessageParts;
  firstRequestTokens: number;
  summary: {
    SYS_PROMPT_FALLBACK_CHARS: number;
    TOOL_DEFS_FALLBACK_CHARS: number;
    SYSTEM_REMINDER_CHROME_CHARS: number;
  };
  details?: ConstantDetails;
}

type ConstantKey =
  | 'SYS_PROMPT_FALLBACK_CHARS'
  | 'TOOL_DEFS_FALLBACK_CHARS'
  | 'SYSTEM_REMINDER_CHROME_CHARS';

type ConstantDetails = Partial<Record<ConstantKey, string>>;

interface CurrentConstants {
  source?: 'project' | 'defaults';
  path?: string;
  cwd?: string;
  note?: string;
  SYS_PROMPT_FALLBACK_CHARS: number;
  TOOL_DEFS_FALLBACK_CHARS: number;
  SYSTEM_REMINDER_CHROME_CHARS: number;
  details?: ConstantDetails;
  appliedAt?: string;
  ccVersion?: string;
  model?: string;
}

type AutoCalibrationStatus =
  | 'starting'
  | 'running'
  | 'captured'
  | 'extracting'
  | 'ready'
  | 'failed'
  | 'cancelled';

interface AutoCalibrationJob {
  jobId: string;
  status: AutoCalibrationStatus;
  cwd: string;
  targetHost: string;
  port: number;
  startedAt: string;
  completedAt?: string;
  logFile?: string;
  message: string;
  output: string[];
  result: ExtractedResult | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const S = SEMANTIC;
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

function StatCard({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div style={{
      border: `1px solid ${S.borderColor}`, borderRadius: 11, padding: '14px 16px',
      background: 'oklch(0.20 0.01 265 / 0.5)',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: S.textMuted, fontFamily: SANS }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: accent ?? S.textPrimary3 }}>
        {value}
      </div>
      {unit && <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted2 }}>{unit}</div>}
    </div>
  );
}

function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 2, padding: '10px 14px', borderRadius: 8,
      background: 'oklch(0.50 0.14 25 / 0.15)',
      border: '1px solid oklch(0.50 0.14 25 / 0.3)',
      color: 'oklch(0.72 0.14 25)', fontSize: 13,
    }}>
      {children}
    </div>
  );
}

function DetailButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        border: `1px solid ${disabled ? S.borderSubtle2 : S.borderColor}`,
        borderRadius: 7,
        padding: '4px 8px',
        background: disabled ? 'oklch(0.19 0.008 265)' : 'oklch(0.22 0.012 265)',
        color: disabled ? S.textMuted2 : S.textSecondary,
        fontSize: 11,
        fontFamily: SANS,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      查看
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CalibratePage() {
  const setPage = useUIStore((s) => s.setPage);
  const sessionCwd = useSessionStore((s) => s.currentSession?.cwd);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const currentTurnIndex = useSessionStore((s) => s.currentTurnIndex);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [currentConstants, setCurrentConstants] = useState<CurrentConstants | null>(null);
  const [autoPrompt, setAutoPrompt] = useState('say hi');
  const [autoTargetHost, setAutoTargetHost] = useState('http://127.0.0.1:15721');
  const [autoJob, setAutoJob] = useState<AutoCalibrationJob | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [detailModal, setDetailModal] = useState<{ key: ConstantKey; title: string; text: string } | null>(null);
  const [detailTranslations, setDetailTranslations] = useState<ConstantDetails>({});
  const [detailTranslating, setDetailTranslating] = useState(false);
  const [detailTranslateError, setDetailTranslateError] = useState<string | null>(null);
  const [detailCopied, setDetailCopied] = useState(false);
  const permissionNotice = getCalibrationFailureNotice(autoJob);

  // Load current constants on mount
  useEffect(() => {
    if (!sessionCwd) {
      setCurrentConstants(null);
      return;
    }
    get<CurrentConstants>(`/calibrate/current?cwd=${encodeURIComponent(sessionCwd)}`)
      .then(setCurrentConstants)
      .catch((err) => setError((err as Error).message));
  }, [sessionCwd]);

  const handleAutoStart = useCallback(async () => {
    if (!sessionCwd) {
      setError('请先打开一个会话，以便自动检测项目目录。');
      return;
    }
    setError(null);
    setApplied(false);
    setAutoRunning(true);
    setResult(null);
    try {
      const job = await post<AutoCalibrationJob>('/calibrate/auto/start', {
        cwd: sessionCwd,
        prompt: autoPrompt.trim() || 'say hi',
        targetHost: autoTargetHost.trim() || 'api.deepseek.com',
        timeoutMs: 45000,
      });
      setAutoJob(job);
    } catch (err) {
      setError((err as Error).message);
      setAutoRunning(false);
    }
  }, [autoPrompt, autoTargetHost, sessionCwd]);

  useEffect(() => {
    if (!autoJob?.jobId) return;
    if (autoJob.status === 'ready' || autoJob.status === 'failed' || autoJob.status === 'cancelled') {
      setAutoRunning(false);
      if (autoJob.status === 'ready' && autoJob.result) {
        setResult(autoJob.result);
      }
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const next = await get<AutoCalibrationJob>(`/calibrate/auto/${autoJob.jobId}`);
        setAutoJob(next);
      } catch (err) {
        setError((err as Error).message);
        setAutoRunning(false);
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [autoJob]);

  const handleAutoCancel = useCallback(async () => {
    if (!autoJob?.jobId) return;
    try {
      const next = await post<AutoCalibrationJob>(`/calibrate/auto/${autoJob.jobId}/cancel`);
      setAutoJob(next);
      setAutoRunning(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [autoJob?.jobId]);

  // Apply constants
  const handleApply = useCallback(async () => {
    if (!result) return;
    if (!sessionCwd) {
      setError('请先打开一个会话，以便确定项目 cwd。');
      return;
    }
    setApplying(true);
    try {
      await put('/calibrate/apply', {
        cwd: sessionCwd,
        summary: result.summary,
        details: result.details,
        ccVersion: result.ccVersion,
        model: result.model,
      });
      setApplied(true);
      if (sessionCwd) {
        get<CurrentConstants>(`/calibrate/current?cwd=${encodeURIComponent(sessionCwd)}`)
          .then(setCurrentConstants)
          .catch(() => {});
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }, [result, sessionCwd]);

  // Token estimate
  const estTok = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

  const openDetail = useCallback((key: ConstantKey, details: ConstantDetails | undefined, title: string) => {
    const text = details?.[key];
    if (!text) return;
    setDetailModal({ key, title, text });
    setDetailCopied(false);
    setDetailTranslateError(null);
  }, []);

  const detailTranslatedText = detailModal ? detailTranslations[detailModal.key] : undefined;
  const detailLayout = getCalibrationDetailLayout(detailTranslatedText);

  const handleDetailCopy = useCallback(async () => {
    if (!detailModal) return;
    const text = detailTranslatedText
      ? `原文\n\n${detailModal.text}\n\n译文\n\n${detailTranslatedText}`
      : detailModal.text;
    try {
      await navigator.clipboard.writeText(text);
      setDetailCopied(true);
      window.setTimeout(() => setDetailCopied(false), 2000);
    } catch {
      setDetailTranslateError('复制失败：浏览器剪贴板不可用。');
    }
  }, [detailModal, detailTranslatedText]);

  const handleDetailTranslate = useCallback(async () => {
    if (!detailModal || detailTranslating) return;
    if (detailTranslations[detailModal.key]) return;
    if (!currentSessionId || currentTurnIndex == null) {
      setDetailTranslateError('请先打开一个会话和轮次，再使用翻译。');
      return;
    }
    setDetailTranslateError(null);
    setDetailTranslating(true);
    try {
      const res = await post<{ translated: string }>(`/sessions/${currentSessionId}/translate`, {
        text: detailModal.text,
        turnIndex: currentTurnIndex,
        stepIndex: -100,
        sectionIndex: getCalibrationDetailSectionIndex(detailModal.key, detailModal.text),
      });
      setDetailTranslations((prev) => ({ ...prev, [detailModal.key]: res.translated }));
    } catch (err) {
      setDetailTranslateError((err as Error).message);
    } finally {
      setDetailTranslating(false);
    }
  }, [currentSessionId, currentTurnIndex, detailModal, detailTranslating, detailTranslations]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 0', fontFamily: SANS, color: 'oklch(0.93 0.006 265)' }}>
      {detailModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1200,
            background: 'oklch(0.10 0.006 265 / 0.74)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => setDetailModal(null)}
        >
          <div
            style={{
              width: 'min(980px, 96vw)', maxHeight: '88vh', overflow: 'hidden',
              background: 'oklch(0.155 0.008 265)',
              border: `1px solid ${S.borderColor}`, borderRadius: 14,
              boxShadow: '0 34px 90px oklch(0 0 0 / 0.58)',
              display: 'flex', flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 18px', borderBottom: `1px solid ${S.borderColor}`, background: 'oklch(0.185 0.009 265)' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 650, color: S.textPrimary3 }}>{detailModal.title}</div>
                <div style={{ fontSize: 11, color: S.textMuted, fontFamily: MONO }}>{detailModal.key}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={handleDetailCopy}
                  style={{
                    border: `1px solid ${detailCopied ? 'oklch(0.45 0.08 150 / 0.42)' : S.borderColor}`,
                    borderRadius: 7,
                    padding: '5px 10px',
                    background: detailCopied ? 'oklch(0.55 0.08 150 / 0.12)' : 'oklch(0.22 0.01 265)',
                    color: detailCopied ? S.textGreen : S.textSecondary,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: SANS,
                  }}
                >
                  {detailCopied ? '已复制' : '复制'}
                </button>
                <button
                  onClick={handleDetailTranslate}
                  disabled={detailTranslating || Boolean(detailTranslatedText)}
                  style={{
                    border: `1px solid ${detailTranslatedText ? 'oklch(0.45 0.08 150 / 0.35)' : 'oklch(0.45 0.10 60 / 0.18)'}`,
                    borderRadius: 7,
                    padding: '5px 10px',
                    background: detailTranslatedText ? 'oklch(0.55 0.08 150 / 0.10)' : 'oklch(0.45 0.10 60 / 0.08)',
                    color: detailTranslatedText ? S.textGreen : S.textAccent2,
                    cursor: detailTranslating ? 'wait' : detailTranslatedText ? 'default' : 'pointer',
                    opacity: detailTranslating ? 0.65 : 1,
                    fontSize: 12,
                    fontFamily: SANS,
                  }}
                >
                  {detailTranslating ? '翻译中...' : detailTranslatedText ? '已翻译' : '翻译'}
                </button>
                <button
                  onClick={() => setDetailModal(null)}
                  style={{ border: `1px solid ${S.borderColor}`, borderRadius: 8, width: 30, height: 30, background: 'oklch(0.22 0.01 265)', color: S.textSecondary, cursor: 'pointer', fontSize: 14 }}
                >
                  x
                </button>
              </div>
            </div>
            {detailTranslateError && (
              <div style={{ padding: '10px 18px 0', fontSize: 12, color: 'oklch(0.72 0.14 25)' }}>
                {detailTranslateError}
              </div>
            )}
            <div style={{ padding: '16px 18px', overflow: 'auto' }}>
              {detailLayout === 'side-by-side' ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                  gap: 14,
                  minWidth: 760,
                  alignItems: 'start',
                }}>
                  <div>
                    <div style={{ marginBottom: 8, fontSize: 11, color: S.textMuted, fontFamily: MONO }}>原文</div>
                    <MarkdownBlock text={detailModal.text} variant="markdown" preserveNewlines />
                  </div>
                  <div>
                    <div style={{ marginBottom: 8, fontSize: 11, color: S.textMuted, fontFamily: MONO }}>译文</div>
                    <MarkdownBlock text={detailTranslatedText || ''} variant="markdown" preserveNewlines />
                  </div>
                </div>
              ) : (
                <MarkdownBlock text={detailModal.text} variant="markdown" preserveNewlines />
              )}
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="header-bar">
        <div style={{ maxWidth: 680 }}>
          <div className="tag">
            <div className="tag-dot" />
            <span className="tag-text">上下文常量校准器</span>
          </div>
          <h1>更新系统级上下文常量</h1>
          <p className="subtitle">
            Claude Code 版本更新后，系统提示词、工具定义等上下文常量可能变化。使用无 sudo 本地代理自动截获一次请求，并将日志固定写入项目内 .claude-trace/。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 9, fontFamily: MONO, fontSize: 12 }}>
          <a href="#" onClick={e => { e.preventDefault(); setPage('inspector'); }}
            style={{ textDecoration: 'none', border: `1px solid ${S.borderColor}`, borderRadius: 9, padding: '9px 14px', color: S.textSecondary, background: 'oklch(0.20 0.01 265 / 0.6)' }}>
            &larr; 逐轮检查
          </a>
          <span style={{ border: `1px solid ${S.borderAccent}`, borderRadius: 9, padding: '9px 14px', color: S.textAccent2, background: 'oklch(0.74 0.13 60 / 0.12)' }}>
            校准常量
          </span>
        </div>
      </header>

      {/* Step 1: Automatic capture */}
      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>1. 自动截获 API 请求</h2>
        <p style={{ fontSize: 13, color: S.textDesc3, marginBottom: 16, lineHeight: 1.6 }}>
          使用无 sudo 本地代理启动一次 Claude Code，请求成功后会自动解析捕获日志。日志固定写入当前会话项目的 .claude-trace/ 目录。
        </p>
        <div style={{
          border: `1px solid ${S.borderColor}`, borderRadius: 13, padding: '16px 18px',
          background: 'oklch(0.185 0.009 265)', display: 'grid', gap: 12,
        }}>
          <div style={{ fontSize: 12, color: S.textMuted, fontFamily: MONO, wordBreak: 'break-all' }}>
            cwd: {sessionCwd || '未选择会话'}
          </div>
          <div style={{ fontSize: 12, color: S.textDesc3, lineHeight: 1.5 }}>
            Capture Target 可填完整 Base URL（如 cc_switch 的 http://127.0.0.1:15721），也可填裸 host（如 api.deepseek.com）。
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 5, fontSize: 11, color: S.textMuted, fontFamily: SANS, flex: '1 1 340px', minWidth: 0 }}>
              Prompt
              <input
                value={autoPrompt}
                onChange={(e) => setAutoPrompt(e.target.value)}
                disabled={autoRunning}
                style={{
                  border: `1px solid ${S.borderColor}`, borderRadius: 8, padding: '10px 12px',
                  background: 'oklch(0.16 0.01 265)', color: S.textPrimary3, fontFamily: MONO,
                }}
                aria-label="校准 prompt"
              />
            </label>
            <label style={{ display: 'grid', gap: 5, fontSize: 11, color: S.textMuted, fontFamily: SANS, flex: '1 1 220px', minWidth: 0 }}>
              Capture Target
              <input
                value={autoTargetHost}
                onChange={(e) => setAutoTargetHost(e.target.value)}
                disabled={autoRunning}
                style={{
                  border: `1px solid ${S.borderColor}`, borderRadius: 8, padding: '10px 12px',
                  background: 'oklch(0.16 0.01 265)', color: S.textPrimary3, fontFamily: MONO,
                }}
                aria-label="捕获目标 host 或 base url"
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              disabled={!sessionCwd || autoRunning}
              onClick={handleAutoStart}
              style={{
                border: 'none', borderRadius: 10, padding: '12px 24px',
                fontSize: 14, fontWeight: 600, fontFamily: SANS,
                cursor: (!sessionCwd || autoRunning) ? 'not-allowed' : 'pointer',
                background: (!sessionCwd || autoRunning) ? 'oklch(0.28 0.01 265)' : 'oklch(0.74 0.13 60)',
                color: (!sessionCwd || autoRunning) ? S.textMuted : 'oklch(0.12 0.01 265)',
              }}
            >
              {autoRunning ? '截获中...' : '自动截获并提取'}
            </button>
            {autoRunning && (
              <button
                onClick={handleAutoCancel}
                style={{
                  border: `1px solid ${S.borderColor}`, borderRadius: 10, padding: '11px 18px',
                  background: 'transparent', color: S.textSecondary, fontFamily: SANS, cursor: 'pointer',
                }}
              >
                取消
              </button>
            )}
            {autoJob && (
              <span style={{ fontSize: 12, color: autoJob.status === 'failed' ? 'oklch(0.72 0.14 25)' : S.textDesc3 }}>
                {autoJob.message}
              </span>
            )}
          </div>
          {autoJob?.logFile && (
            <div style={{ fontSize: 11, color: S.textMuted, fontFamily: MONO, wordBreak: 'break-all' }}>
              log: {autoJob.logFile}
            </div>
          )}
          {permissionNotice ? (
            <ErrorNotice>
              <div style={{ fontWeight: 600, color: 'oklch(0.78 0.14 25)', marginBottom: 4 }}>
                {permissionNotice.title}
              </div>
              <div style={{ lineHeight: 1.5 }}>{permissionNotice.detail}</div>
              {permissionNotice.command && (
                <pre style={{
                  margin: '8px 0 0', padding: '8px 10px', borderRadius: 7,
                  background: 'oklch(0.15 0.01 265)', color: S.textPrimary3,
                  fontFamily: MONO, fontSize: 12, whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>{permissionNotice.command}</pre>
              )}
            </ErrorNotice>
          ) : autoJob?.error && (
            <div style={{ fontSize: 12, color: 'oklch(0.72 0.14 25)' }}>
              {autoJob.error}
            </div>
          )}
          {error && (
            <ErrorNotice>
              {error}
            </ErrorNotice>
          )}
        </div>
      </section>

      {/* Step 2: Results */}
      {result && (
        <section style={{ marginTop: 30 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>2. 提取结果</h2>

          {/* Meta */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <StatCard label="Claude Code 版本" value={result.ccVersion} />
            <StatCard label="模型" value={result.model} />
            <StatCard label="首次请求 Token" value={fmt(result.firstRequestTokens)} accent="oklch(0.74 0.13 60)" />
            <StatCard label="工具定义字符数" value={(result.toolsChars / 1000).toFixed(1) + 'K'} unit={`≈ ${estTok(result.toolsChars)} tok`} />
          </div>

          {/* System blocks */}
          <div style={{
            border: `1px solid ${S.borderColor}`, borderRadius: 13, padding: '18px 20px',
            background: 'oklch(0.185 0.009 265)', marginBottom: 16,
          }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>System Blocks</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatCard label="Billing Header" value={result.systemBlocks.billing + ''} unit="chars" />
              <StatCard label="Agent Identity" value={result.systemBlocks.agentIdentity + ''} unit="chars" />
              <StatCard label="Harness Prompt" value={(result.systemBlocks.harness / 1000).toFixed(1) + 'K'} unit={`${result.systemBlocks.harness} chars`} />
              <StatCard label="总计" value={(result.summary.SYS_PROMPT_FALLBACK_CHARS / 1000).toFixed(1) + 'K'} unit="chars" accent="oklch(0.67 0.15 25)" />
            </div>
          </div>

          {/* User message breakdown */}
          <div style={{
            border: `1px solid ${S.borderColor}`, borderRadius: 13, padding: '18px 20px',
            background: 'oklch(0.185 0.009 265)', marginBottom: 16,
          }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>&lt;system-reminder&gt; 包裹体</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatCard label="总字符数" value={result.userMessage.total + ''} unit="chars" />
              <StatCard label="Chrome/包装" value={result.userMessage.chrome + ''} unit="chars" />
              <StatCard label="Global CLAUDE.md" value={(result.userMessage.globalClaudeMd / 1000).toFixed(1) + 'K'} unit="chars" />
              {result.userMessage.projectClaudeMd > 0 && (
                <StatCard label="Project CLAUDE.md" value={(result.userMessage.projectClaudeMd / 1000).toFixed(1) + 'K'} unit="chars" />
              )}
              {result.userMessage.mcpInstructions > 0 && (
                <StatCard label="MCP 指令" value={result.userMessage.mcpInstructions + ''} unit="chars" />
              )}
              {result.userMessage.skillsListing > 0 && (
                <StatCard label="技能列表" value={(result.userMessage.skillsListing / 1000).toFixed(1) + 'K'} unit="chars" />
              )}
              <StatCard label="日期/注记" value={result.userMessage.currentDate + ''} unit="chars" />
            </div>
          </div>

          {/* Summary: the three key constants */}
          <div style={{
            border: `1px solid oklch(0.74 0.13 60 / 0.4)`, borderRadius: 13, padding: '18px 20px',
            background: 'oklch(0.74 0.13 60 / 0.08)', marginBottom: 16,
          }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: 'oklch(0.74 0.13 60)' }}>将应用的常量</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>SYS_PROMPT_FALLBACK_CHARS</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600 }}>{result.summary.SYS_PROMPT_FALLBACK_CHARS.toLocaleString()}</div>
                  <DetailButton
                    disabled={!result.details?.SYS_PROMPT_FALLBACK_CHARS}
                    onClick={() => openDetail('SYS_PROMPT_FALLBACK_CHARS', result.details, '系统提示词内容')}
                  />
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted2 }}>≈ {estTok(result.summary.SYS_PROMPT_FALLBACK_CHARS)} tok</div>
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>TOOL_DEFS_FALLBACK_CHARS</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600 }}>{result.summary.TOOL_DEFS_FALLBACK_CHARS.toLocaleString()}</div>
                  <DetailButton
                    disabled={!result.details?.TOOL_DEFS_FALLBACK_CHARS}
                    onClick={() => openDetail('TOOL_DEFS_FALLBACK_CHARS', result.details, '工具定义 JSON')}
                  />
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted2 }}>≈ {estTok(result.summary.TOOL_DEFS_FALLBACK_CHARS)} tok</div>
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>SYSTEM_REMINDER_CHROME_CHARS</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600 }}>{result.summary.SYSTEM_REMINDER_CHROME_CHARS.toLocaleString()}</div>
                  <DetailButton
                    disabled={!result.details?.SYSTEM_REMINDER_CHROME_CHARS}
                    onClick={() => openDetail('SYSTEM_REMINDER_CHROME_CHARS', result.details, 'system-reminder 包装内容')}
                  />
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted2 }}>≈ {estTok(result.summary.SYSTEM_REMINDER_CHROME_CHARS)} tok</div>
              </div>
            </div>
          </div>

          {/* Apply button */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              disabled={applying || applied}
              onClick={handleApply}
              style={{
                border: 'none', borderRadius: 10, padding: '13px 32px',
                fontSize: 14, fontWeight: 600, fontFamily: SANS,
                cursor: (applying || applied) ? 'not-allowed' : 'pointer',
                background: applied ? 'oklch(0.64 0.13 148)' : 'oklch(0.74 0.13 60)',
                color: 'oklch(0.12 0.01 265)', opacity: (applying || applied) ? 0.7 : 1,
              }}
            >
              {applying ? '写入中...' : applied ? '✓ 已应用 — 下次导入自动生效' : '应用常量'}
            </button>
            {!applied && (
              <span style={{ fontSize: 12, color: S.textDesc3 }}>
                将常量写入当前项目的 .claude-trace/ 目录
              </span>
            )}
          </div>
        </section>
      )}

      {/* Step 3: Current constants */}
      <section style={{ marginTop: 30, borderTop: `1px solid ${S.borderSubtle2}`, paddingTop: 22 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>3. 当前项目生效的常量</h2>
        <div style={{
          border: `1px solid ${S.borderColor}`, borderRadius: 13, padding: '18px 20px',
          background: 'oklch(0.185 0.009 265)',
        }}>
          {!sessionCwd ? (
            <div style={{ fontSize: 13, color: S.textDesc3 }}>
              请先打开一个会话，以便确定项目 cwd。
            </div>
          ) : currentConstants ? (
            <>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
                <StatCard label="来源" value={currentConstants.source === 'project' ? '项目校准' : '内置默认'} />
                {currentConstants.appliedAt && (
                  <StatCard label="校准时间" value={new Date(currentConstants.appliedAt).toLocaleString()} />
                )}
                <StatCard label="CC 版本" value={currentConstants.ccVersion || '-'} />
                <StatCard label="模型" value={currentConstants.model || '-'} />
              </div>
              <div style={{ fontSize: 11, color: S.textMuted, fontFamily: MONO, wordBreak: 'break-all', marginBottom: 14 }}>
                {currentConstants.path ? `path: ${currentConstants.path}` : `cwd: ${sessionCwd}`}
              </div>
              {currentConstants.note && (
                <div style={{ fontSize: 12, color: S.textDesc3, marginBottom: 14 }}>
                  {currentConstants.note}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>SYS_PROMPT_FALLBACK_CHARS</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>{currentConstants.SYS_PROMPT_FALLBACK_CHARS.toLocaleString()}</div>
                    <DetailButton
                      disabled={!currentConstants.details?.SYS_PROMPT_FALLBACK_CHARS}
                      onClick={() => openDetail('SYS_PROMPT_FALLBACK_CHARS', currentConstants.details, '系统提示词内容')}
                    />
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>TOOL_DEFS_FALLBACK_CHARS</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>{currentConstants.TOOL_DEFS_FALLBACK_CHARS.toLocaleString()}</div>
                    <DetailButton
                      disabled={!currentConstants.details?.TOOL_DEFS_FALLBACK_CHARS}
                      onClick={() => openDetail('TOOL_DEFS_FALLBACK_CHARS', currentConstants.details, '工具定义 JSON')}
                    />
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>SYSTEM_REMINDER_CHROME_CHARS</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>{currentConstants.SYSTEM_REMINDER_CHROME_CHARS.toLocaleString()}</div>
                    <DetailButton
                      disabled={!currentConstants.details?.SYSTEM_REMINDER_CHROME_CHARS}
                      onClick={() => openDetail('SYSTEM_REMINDER_CHROME_CHARS', currentConstants.details, 'system-reminder 包装内容')}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: S.textDesc3 }}>
              加载中...
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
