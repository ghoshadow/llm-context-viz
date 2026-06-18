import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSessionStore } from '../../store/sessionStore';
import { post, put, get } from '../../api/client';
import { SEMANTIC } from '../../styles/theme';
import { fmt, fmtK } from '../../utils/format';

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
  SYS_PROMPT_FALLBACK_CHARS: number;
  TOOL_DEFS_FALLBACK_CHARS: number;
  SYSTEM_REMINDER_CHROME_CHARS: number;
  appliedAt?: string;
  ccVersion?: string;
  model?: string;
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CalibratePage() {
  const setPage = useUIStore((s) => s.setPage);
  const sessionCwd = useSessionStore((s) => s.currentSession?.cwd);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);

  // Fetch project root from health endpoint
  useEffect(() => {
    get<{ projectRoot?: string }>('/health').then(d => {
      if (d.projectRoot) setProjectRoot(d.projectRoot);
    }).catch(() => {});
  }, []);

  // Pre-fill the proxy command with the session's cwd and project root
  const proxyCommand = useMemo(() => {
    const scriptPath = projectRoot
      ? `${projectRoot}/scripts/transparent-proxy.cjs`
      : '/path/to/llm-context-viz/scripts/transparent-proxy.cjs';
    if (sessionCwd) {
      return `cd ${sessionCwd} && sudo node ${scriptPath} --cwd ${sessionCwd} -- claude -p "say hi"`;
    }
    return `cd /path/to/session-project && sudo node ${scriptPath} --cwd $(pwd) -- claude -p "say hi"`;
  }, [sessionCwd, projectRoot]);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [currentConstants, setCurrentConstants] = useState<CurrentConstants | null>(null);
  const [showCurrent, setShowCurrent] = useState(false);

  // Load current constants on mount
  const loadCurrent = useCallback(async () => {
    try {
      const data = await get<CurrentConstants>('/calibrate/calibrate/current');
      setCurrentConstants(data);
      setShowCurrent(true);
    } catch { /* ignore */ }
  }, []);

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setError(null); setResult(null); setApplied(false); }
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setError(null); setResult(null); setApplied(false); }
  }, []);

  // Upload & extract
  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await post<ExtractedResult>('/calibrate/calibrate', formData);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }, [file]);

  // Apply constants
  const handleApply = useCallback(async () => {
    if (!result) return;
    setApplying(true);
    try {
      await put('/calibrate/calibrate/apply', {
        summary: result.summary,
        ccVersion: result.ccVersion,
        model: result.model,
      });
      setApplied(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }, [result]);

  // Token estimate
  const estTok = (chars: number) => Math.round(chars / 3.5);

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
            Claude Code 版本更新后，系统提示词、工具定义等上下文常量可能变化。使用代理截获一次请求，上传日志自动提取并应用新常量。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 9, fontFamily: MONO, fontSize: 12 }}>
          <a href="#" onClick={e => { e.preventDefault(); setPage('home'); }}
            style={{ textDecoration: 'none', border: `1px solid ${S.borderColor}`, borderRadius: 9, padding: '9px 14px', color: S.textSecondary, background: 'oklch(0.20 0.01 265 / 0.6)' }}>
            &larr; 首页
          </a>
          <span style={{ border: `1px solid ${S.borderAccent}`, borderRadius: 9, padding: '9px 14px', color: S.textAccent2, background: 'oklch(0.74 0.13 60 / 0.12)' }}>
            校准
          </span>
        </div>
      </header>

      {/* Step 1: Upload */}
      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>1. 上传截获的 API 日志</h2>
        <p style={{ fontSize: 13, color: S.textDesc3, marginBottom: 16, lineHeight: 1.6 }}>
          在终端运行以下命令截获一次请求（{sessionCwd ? '已自动填入当前会话的项目目录' : '请先打开一个会话以启用自动检测'}），然后上传生成的 <code style={{ fontFamily: MONO, background: 'oklch(0.24 0.01 265)', padding: '2px 6px', borderRadius: 4 }}>.claude-trace/api-log-*.jsonl</code> 文件。
        </p>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${file ? 'oklch(0.74 0.13 60)' : S.borderColor}`,
            borderRadius: 14, padding: '40px 20px', textAlign: 'center',
            cursor: 'pointer', background: file ? 'oklch(0.74 0.13 60 / 0.06)' : 'oklch(0.18 0.01 265)',
            transition: 'all .2s',
          }}
        >
          <input ref={fileInputRef} type="file" accept=".jsonl" onChange={handleFileChange} style={{ display: 'none' }} />
          {file ? (
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'oklch(0.74 0.13 60)' }}>{file.name}</div>
              <div style={{ fontSize: 12, color: S.textMuted, marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
              <div style={{ fontSize: 14, color: S.textDesc3 }}>拖拽 .jsonl 文件到此处，或点击选择</div>
            </div>
          )}
        </div>

        <button
          disabled={!file || uploading}
          onClick={handleUpload}
          style={{
            marginTop: 14, border: 'none', borderRadius: 10, padding: '12px 28px',
            fontSize: 14, fontWeight: 600, fontFamily: SANS, cursor: (!file || uploading) ? 'not-allowed' : 'pointer',
            background: (!file || uploading) ? 'oklch(0.28 0.01 265)' : 'oklch(0.74 0.13 60)',
            color: (!file || uploading) ? S.textMuted : 'oklch(0.12 0.01 265)',
            opacity: (!file || uploading) ? 0.6 : 1,
          }}
        >
          {uploading ? '解析中...' : '提取常量'}
        </button>

        {error && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'oklch(0.50 0.14 25 / 0.15)', border: '1px solid oklch(0.50 0.14 25 / 0.3)', color: 'oklch(0.72 0.14 25)', fontSize: 13 }}>
            {error}
          </div>
        )}
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
                将 system-constants.json 写入 src/pipeline/ 目录
              </span>
            )}
          </div>
        </section>
      )}

      {/* Step 3: Current constants */}
      <section style={{ marginTop: 30, borderTop: `1px solid ${S.borderSubtle2}`, paddingTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>3. 当前生效的常量</h2>
          <button
            onClick={loadCurrent}
            style={{
              border: `1px solid ${S.borderColor}`, borderRadius: 7, padding: '6px 14px',
              fontSize: 12, fontFamily: MONO, cursor: 'pointer',
              background: 'oklch(0.20 0.01 265 / 0.6)', color: S.textSecondary,
            }}
          >
            {showCurrent ? '刷新' : '查看'}
          </button>
        </div>

        {showCurrent && currentConstants && (
          <div style={{
            border: `1px solid ${S.borderColor}`, borderRadius: 13, padding: '18px 20px',
            background: 'oklch(0.185 0.009 265)',
          }}>
            {currentConstants.appliedAt ? (
              <>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
                  <StatCard label="校准时间" value={new Date(currentConstants.appliedAt).toLocaleString()} />
                  <StatCard label="CC 版本" value={currentConstants.ccVersion || '-'} />
                  <StatCard label="模型" value={currentConstants.model || '-'} />
                </div>
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
                使用默认常量。上传截获日志并应用以覆盖。
              </div>
            )}
          </div>
        )}
      </section>

      {/* Footer: proxy usage */}
      <footer style={{ marginTop: 30, borderTop: `1px solid ${S.borderSubtle2}`, paddingTop: 18 }}>
        <details style={{ fontSize: 12.5, color: S.textDesc3, lineHeight: 1.7 }}>
          <summary style={{ cursor: 'pointer', color: S.textSecondary, fontSize: 13, fontWeight: 500 }}>
            如何截获 API 请求？</summary>
          <div style={{ marginTop: 10, background: 'oklch(0.18 0.01 265)', padding: '14px 18px', borderRadius: 10, border: `1px solid ${S.borderSubtle1}` }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'oklch(0.80 0.05 148)', lineHeight: 1.8 }}>
              <div># 1. 启动透明代理（会临时修改 /etc/hosts，退出时自动恢复）</div>
              {sessionCwd ? (
                <div>
                  <div style={{ color: S.textMuted }}># 已自动填入当前会话的项目目录 ({sessionCwd})</div>
                  <span style={{ background: 'oklch(0.24 0.01 265)', padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {proxyCommand}
                  </span>
                </div>
              ) : (
                <div>
                  <div style={{ color: S.textMuted }}># 未加载会话，请先打开一个会话以自动检测项目目录</div>
                  <span style={{ background: 'oklch(0.24 0.01 265)', padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {`sudo node ${projectRoot || '/path/to/llm-context-viz'}/scripts/transparent-proxy.cjs --cwd /path/to/project -- claude -p "say hi"`}
                  </span>
                </div>
              )}
              <div style={{ marginTop: 8 }}># 2. 代理会在运行目录生成 .claude-trace/api-log-*.jsonl</div>
              <div># 3. 在此页面拖拽上传该文件</div>
            </div>
          </div>
        </details>
      </footer>
    </div>
  );
}
