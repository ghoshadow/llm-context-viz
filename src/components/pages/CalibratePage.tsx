import { useState, useCallback, useEffect } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSessionStore } from '../../store/sessionStore';
import { post, put, get } from '../../api/client';
import { SEMANTIC } from '../../styles/theme';
import { fmt } from '../../utils/format';
import { CHARS_PER_TOKEN } from '../../pipeline/utils';
import { getCalibrationFailureNotice } from './calibrationFailureNotice';

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
}

interface CurrentConstants {
  source?: 'project' | 'defaults';
  path?: string;
  cwd?: string;
  note?: string;
  SYS_PROMPT_FALLBACK_CHARS: number;
  TOOL_DEFS_FALLBACK_CHARS: number;
  SYSTEM_REMINDER_CHROME_CHARS: number;
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CalibratePage() {
  const setPage = useUIStore((s) => s.setPage);
  const sessionCwd = useSessionStore((s) => s.currentSession?.cwd);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [currentConstants, setCurrentConstants] = useState<CurrentConstants | null>(null);
  const [autoPrompt, setAutoPrompt] = useState('say hi');
  const [autoTargetHost, setAutoTargetHost] = useState('http://127.0.0.1:15721');
  const [autoJob, setAutoJob] = useState<AutoCalibrationJob | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
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

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 0', fontFamily: SANS, color: 'oklch(0.93 0.006 265)' }}>
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
                <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600 }}>{result.summary.SYS_PROMPT_FALLBACK_CHARS.toLocaleString()}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted2 }}>≈ {estTok(result.summary.SYS_PROMPT_FALLBACK_CHARS)} tok</div>
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>TOOL_DEFS_FALLBACK_CHARS</div>
                <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600 }}>{result.summary.TOOL_DEFS_FALLBACK_CHARS.toLocaleString()}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted2 }}>≈ {estTok(result.summary.TOOL_DEFS_FALLBACK_CHARS)} tok</div>
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>SYSTEM_REMINDER_CHROME_CHARS</div>
                <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600 }}>{result.summary.SYSTEM_REMINDER_CHROME_CHARS.toLocaleString()}</div>
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
                  <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>{currentConstants.SYS_PROMPT_FALLBACK_CHARS.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>TOOL_DEFS_FALLBACK_CHARS</div>
                  <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>{currentConstants.TOOL_DEFS_FALLBACK_CHARS.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: S.textMuted }}>SYSTEM_REMINDER_CHROME_CHARS</div>
                  <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 600 }}>{currentConstants.SYSTEM_REMINDER_CHROME_CHARS.toLocaleString()}</div>
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
