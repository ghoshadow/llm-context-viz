import { useState, useCallback, useEffect, useMemo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSessionStore } from '../../store/sessionStore';
import { put, get } from '../../api/client';
import { SEMANTIC } from '../../styles/theme';
import { fmt } from '../../utils/format';
import { getCalibrationFailureNotice } from './calibrationFailureNotice';
import {
  getCalibrationDetailDisplay,
  getCalibrationDetailLayout,
  getCalibrationDetailTranslationSlot,
} from './calibrationDetailModal';
import {
  type AgentSource,
  type CalibrationCategoryMap,
  type CalibrationDetails,
  type NormalizedCalibrationSummaryLike,
  buildCalibrationCategoryRows,
  getNormalizedCalibrationSummary,
  sumCalibrationCategoryChars,
} from './calibrationCategories';
import {
  captureTargetPlaceholderText,
  defaultCalibrationPromptInput,
  defaultCalibrationTargetInput,
} from './calibrationAutoStart';
import {
  calibrationSourceAutoLaunchSupported,
  calibrationSourceFromSession,
  calibrationSourceLabel,
  calibrationTraceDirName,
} from './calibrationSource';
import {
  CalibrationCategoryRows,
  CalibrationDetailDialog,
  CalibrationErrorNotice,
  CalibrationStatCard,
  estimateCalibrationTokens,
  type CalibrationDetailModalState,
} from './calibrationPagePanels';
import { useCurrentCalibrationConstants } from './useCurrentCalibrationConstants';
import { useAutoCalibrationJob } from './useAutoCalibrationJob';
import { useCalibrationDetailTranslation } from './useCalibrationDetailTranslation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemBlocks {
  total: number;
  billing: number;
  agentIdentity: number;
  harness: number;
}

export interface UserMessageParts {
  total: number;
  chrome: number;
  globalClaudeMd: number;
  projectClaudeMd: number;
  mcpInstructions: number;
  skillsListing: number;
  currentDate: number;
  sessionGuidance: number;
}

export interface ExtractedResult {
  schemaVersion?: 1;
  source?: AgentSource;
  constantsSource?: 'project' | 'defaults' | 'capture';
  path?: string;
  cwd?: string;
  note?: string;
  appliedAt?: string;
  sourceFile?: string;
  ccVersion?: string;
  cliVersion?: string;
  model?: string;
  wireApi?: string;
  rawLogPath?: string;
  categories?: CalibrationCategoryMap;
  usage?: NormalizedCalibrationSummaryLike['usage'];
  toolNames?: string[];
  hashes?: Record<string, string>;
  summary?: NormalizedCalibrationSummaryLike | {
    SYS_PROMPT_FALLBACK_CHARS?: number;
    TOOL_DEFS_FALLBACK_CHARS?: number;
    SYSTEM_REMINDER_CHROME_CHARS?: number;
  };
  systemBlocks?: SystemBlocks;
  toolsChars?: number;
  userMessage?: UserMessageParts;
  firstRequestTokens?: number;
  details?: ConstantDetails;
}

type ConstantKey = string;
export type ConstantDetails = Partial<CalibrationDetails>;
type CurrentConstants = ExtractedResult;
type CalibrationUiSource = AgentSource;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const S = SEMANTIC;
const MONO = "'IBM Plex Mono', monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CalibratePage() {
  const setPage = useUIStore((s) => s.setPage);
  const currentSession = useSessionStore((s) => s.currentSession);
  const sessionCwd = currentSession?.cwd;
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const currentTurnIndex = useSessionStore((s) => s.currentTurnIndex);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [loadingLatestCapture, setLoadingLatestCapture] = useState(false);
  const [calibrationSource, setCalibrationSource] = useState<CalibrationUiSource>('claude');
  const [autoPrompt, setAutoPrompt] = useState(defaultCalibrationPromptInput('claude'));
  const [autoTargetHost, setAutoTargetHost] = useState(defaultCalibrationTargetInput('claude'));
  const [detailModal, setDetailModal] = useState<CalibrationDetailModalState | null>(null);
  const [detailTranslations, setDetailTranslations] = useState<ConstantDetails>({});
  const handleCalibrationError = useCallback((message: string) => setError(message), []);
  const handleAutoResult = useCallback((nextResult: ExtractedResult) => setResult(nextResult), []);
  const handleAutoBeforeStart = useCallback(() => {
    setError(null);
    setApplied(false);
    setResult(null);
  }, []);
  const { currentConstants, setCurrentConstants } = useCurrentCalibrationConstants<CurrentConstants>({
    sessionCwd,
    calibrationSource,
    onError: handleCalibrationError,
  });
  const {
    autoJob,
    autoRunning,
    setAutoJob,
    handleAutoStart,
    handleAutoCancel,
  } = useAutoCalibrationJob({
    sessionCwd,
    calibrationSource,
    autoPrompt,
    autoTargetHost,
    onResult: handleAutoResult,
    onError: handleCalibrationError,
    onBeforeStart: handleAutoBeforeStart,
  });
  const permissionNotice = getCalibrationFailureNotice(autoJob);
  const autoLaunchSupported = calibrationSourceAutoLaunchSupported(calibrationSource);
  const calibrationLabel = calibrationSourceLabel(calibrationSource);
  const sessionCalibrationSource = useMemo(() => calibrationSourceFromSession(currentSession), [currentSession]);
  const resultSummary = useMemo(() => getNormalizedCalibrationSummary(result), [result]);
  const resultRows = useMemo(
    () => buildCalibrationCategoryRows(resultSummary.categories, result?.details),
    [result?.details, resultSummary.categories],
  );
  const resultTotalChars = useMemo(() => sumCalibrationCategoryChars(resultRows), [resultRows]);
  const currentSummary = useMemo(() => getNormalizedCalibrationSummary(currentConstants), [currentConstants]);
  const currentRows = useMemo(
    () => buildCalibrationCategoryRows(currentSummary.categories, currentConstants?.details),
    [currentConstants?.details, currentSummary.categories],
  );

  useEffect(() => {
    setCalibrationSource(sessionCalibrationSource);
    setAutoPrompt(defaultCalibrationPromptInput(sessionCalibrationSource));
    setAutoTargetHost(defaultCalibrationTargetInput(sessionCalibrationSource));
    setResult(null);
    setApplied(false);
    setAutoJob(null);
    setError(null);
  }, [currentSessionId, sessionCalibrationSource, setAutoJob]);

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
        source: calibrationSource,
        cwd: sessionCwd,
        summary: resultSummary,
        details: result.details,
        ccVersion: result.ccVersion,
        cliVersion: result.cliVersion,
        model: result.model,
        wireApi: result.wireApi,
        rawLogPath: result.rawLogPath ?? autoJob?.logFile,
      });
      setApplied(true);
      if (sessionCwd) {
        get<CurrentConstants>(`/calibrate/current?cwd=${encodeURIComponent(sessionCwd)}&source=${calibrationSource}`)
          .then(setCurrentConstants)
          .catch(() => {});
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }, [autoJob?.logFile, calibrationSource, result, resultSummary, sessionCwd, setCurrentConstants]);

  const handleLoadLatestCapture = useCallback(async () => {
    if (!sessionCwd) {
      setError('请先打开一个会话，以便确定项目 cwd。');
      return;
    }
    setLoadingLatestCapture(true);
    setError(null);
    setApplied(false);
    setResult(null);
    try {
      const candidate = await get<ExtractedResult>(
        `/calibrate/latest-capture?cwd=${encodeURIComponent(sessionCwd)}&source=${calibrationSource}`,
      );
      setResult(candidate);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingLatestCapture(false);
    }
  }, [calibrationSource, sessionCwd]);

  // Token estimate
  const estTok = estimateCalibrationTokens;

  const detailDisplay = useMemo(
    () => detailModal ? getCalibrationDetailDisplay(detailModal.key, detailModal.text) : undefined,
    [detailModal],
  );
  const detailTranslatedText = detailModal ? detailTranslations[detailModal.key] : undefined;
  const detailTranslatedDisplay = useMemo(
    () => detailModal && detailTranslatedText
      ? getCalibrationDetailDisplay(detailModal.key, detailTranslatedText)
      : undefined,
    [detailModal, detailTranslatedText],
  );
  const detailTranslationSlot = useMemo(
    () => detailModal && detailDisplay
      ? getCalibrationDetailTranslationSlot(detailModal.key, detailDisplay.text)
      : undefined,
    [detailDisplay, detailModal],
  );
  const handleDetailTranslated = useCallback((key: string, translated: string) => {
    setDetailTranslations((prev) => ({ ...prev, [key]: translated }));
  }, []);
  const {
    detailTranslating,
    detailTranslateError,
    detailCopied,
    resetDetailFeedback,
    handleDetailCopy,
    handleDetailTranslate,
  } = useCalibrationDetailTranslation({
    detailModal,
    detailDisplay,
    detailTranslatedText,
    detailTranslatedDisplay,
    onDetailTranslated: handleDetailTranslated,
    currentSessionId,
    currentTurnIndex,
    detailTranslationSlot,
  });
  const detailLayout = getCalibrationDetailLayout(detailTranslatedText);

  const openDetail = useCallback((key: ConstantKey, text: string | undefined, title: string) => {
    if (!text) return;
    setDetailModal({ key, title, text });
    resetDetailFeedback();
  }, [resetDetailFeedback]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 0', fontFamily: SANS, color: 'oklch(0.93 0.006 265)' }}>
      {detailModal && (
        <CalibrationDetailDialog
          modal={detailModal}
          layout={detailLayout}
          display={detailDisplay}
          translatedDisplay={detailTranslatedDisplay}
          translatedText={detailTranslatedText}
          translating={detailTranslating}
          copied={detailCopied}
          error={detailTranslateError}
          onClose={() => setDetailModal(null)}
          onCopy={handleDetailCopy}
          onTranslate={handleDetailTranslate}
        />
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
            所选 agent 版本更新后，系统提示词、工具定义等上下文常量可能变化。自动校准或抓包 JSONL 解析会生成候选常量，确认后写入当前项目 trace 目录。
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

      {/* Step 1: Capture or parse */}
      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          {autoLaunchSupported ? '1. 自动截获 API 请求' : '1. 解析抓包 API 请求'}
        </h2>
        <p style={{ fontSize: 13, color: S.textDesc3, marginBottom: 16, lineHeight: 1.6 }}>
          {autoLaunchSupported
            ? '使用无 sudo 本地代理启动一次所选 agent，请求成功后会自动解析捕获日志。日志固定写入当前会话项目对应的 trace 目录。'
            : `从 ${calibrationTraceDirName(calibrationSource)} 中读取最新 api-log JSONL，解析为 ${calibrationLabel} 候选常量。`}
        </p>
        <div style={{
          border: `1px solid ${S.borderColor}`, borderRadius: 13, padding: '16px 18px',
          background: 'oklch(0.185 0.009 265)', display: 'grid', gap: 12,
        }}>
          <div style={{ fontSize: 12, color: S.textMuted, fontFamily: MONO, wordBreak: 'break-all' }}>
            cwd: {sessionCwd || '未选择会话'}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              border: `1px solid ${S.borderAccent}`,
              borderRadius: 7,
              padding: '6px 10px',
              background: 'oklch(0.24 0.04 245)',
              color: S.textPrimary3,
              fontFamily: SANS,
              fontSize: 12,
            }}>
              {calibrationLabel}
            </span>
            <span style={{ fontSize: 12, color: S.textMuted }}>
              跟随当前会话类型
            </span>
          </div>
          {autoLaunchSupported && (
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
                  placeholder={captureTargetPlaceholderText(calibrationSource)}
                  style={{
                    border: `1px solid ${S.borderColor}`, borderRadius: 8, padding: '10px 12px',
                    background: 'oklch(0.16 0.01 265)', color: S.textPrimary3, fontFamily: MONO,
                  }}
                  aria-label="捕获目标 host 或 base url"
                />
              </label>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {autoLaunchSupported ? (
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
            ) : (
              <button
                disabled={!sessionCwd || loadingLatestCapture}
                onClick={handleLoadLatestCapture}
                style={{
                  border: 'none', borderRadius: 10, padding: '12px 24px',
                  fontSize: 14, fontWeight: 600, fontFamily: SANS,
                  cursor: (!sessionCwd || loadingLatestCapture) ? 'not-allowed' : 'pointer',
                  background: (!sessionCwd || loadingLatestCapture) ? 'oklch(0.28 0.01 265)' : 'oklch(0.74 0.13 60)',
                  color: (!sessionCwd || loadingLatestCapture) ? S.textMuted : 'oklch(0.12 0.01 265)',
                }}
              >
                {loadingLatestCapture ? '解析中...' : '解析最新抓包'}
              </button>
            )}
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
            {autoLaunchSupported && autoJob && (
              <span style={{ fontSize: 12, color: autoJob.status === 'failed' ? 'oklch(0.72 0.14 25)' : S.textDesc3 }}>
                {autoJob.message}
              </span>
            )}
            {!autoLaunchSupported && (
              <span style={{ fontSize: 12, color: S.textDesc3 }}>
                生成候选后可在下方检查并应用。
              </span>
            )}
          </div>
          {autoJob?.logFile && (
            <div style={{ fontSize: 11, color: S.textMuted, fontFamily: MONO, wordBreak: 'break-all' }}>
              log: {autoJob.logFile}
            </div>
          )}
          {autoLaunchSupported && permissionNotice ? (
            <CalibrationErrorNotice>
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
            </CalibrationErrorNotice>
          ) : autoJob?.error && (
            <div style={{ fontSize: 12, color: 'oklch(0.72 0.14 25)' }}>
              {autoJob.error}
            </div>
          )}
          {error && (
            <CalibrationErrorNotice>
              {error}
            </CalibrationErrorNotice>
          )}
        </div>
      </section>

      {/* Step 2: Results */}
      {result && (
        <section style={{ marginTop: 30 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>2. 提取结果</h2>

          {/* Meta */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <CalibrationStatCard label="来源" value={calibrationSourceLabel(result.source ?? calibrationSource)} />
            <CalibrationStatCard label="CLI 版本" value={result.cliVersion || result.ccVersion || '-'} />
            <CalibrationStatCard label="模型" value={result.model || '-'} />
            <CalibrationStatCard
              label="首次请求 Token"
              value={fmt(resultSummary.usage?.firstRequestInputTokens ?? result.firstRequestTokens ?? 0)}
              accent="oklch(0.74 0.13 60)"
            />
            <CalibrationStatCard
              label="总字符数"
              value={(resultTotalChars / 1000).toFixed(1) + 'K'}
              unit={`≈ ${estTok(resultTotalChars)} tok`}
            />
          </div>

          {/* System blocks */}
          {result.systemBlocks && (
            <div style={{
              border: `1px solid ${S.borderColor}`, borderRadius: 13, padding: '18px 20px',
              background: 'oklch(0.185 0.009 265)', marginBottom: 16,
            }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>System Blocks</h3>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <CalibrationStatCard label="Billing Header" value={result.systemBlocks.billing + ''} unit="chars" />
                <CalibrationStatCard label="Agent Identity" value={result.systemBlocks.agentIdentity + ''} unit="chars" />
                <CalibrationStatCard label="Harness Prompt" value={(result.systemBlocks.harness / 1000).toFixed(1) + 'K'} unit={`${result.systemBlocks.harness} chars`} />
                <CalibrationStatCard label="总计" value={(resultTotalChars / 1000).toFixed(1) + 'K'} unit="chars" accent="oklch(0.67 0.15 25)" />
              </div>
            </div>
          )}

          {/* User message breakdown */}
          {result.userMessage && (
            <div style={{
              border: `1px solid ${S.borderColor}`, borderRadius: 13, padding: '18px 20px',
              background: 'oklch(0.185 0.009 265)', marginBottom: 16,
            }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>&lt;system-reminder&gt; 包裹体</h3>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <CalibrationStatCard label="总字符数" value={result.userMessage.total + ''} unit="chars" />
                <CalibrationStatCard label="Chrome/包装" value={result.userMessage.chrome + ''} unit="chars" />
                <CalibrationStatCard label="Global CLAUDE.md" value={(result.userMessage.globalClaudeMd / 1000).toFixed(1) + 'K'} unit="chars" />
                {result.userMessage.projectClaudeMd > 0 && (
                  <CalibrationStatCard label="Project CLAUDE.md" value={(result.userMessage.projectClaudeMd / 1000).toFixed(1) + 'K'} unit="chars" />
                )}
                {result.userMessage.mcpInstructions > 0 && (
                  <CalibrationStatCard label="MCP 指令" value={result.userMessage.mcpInstructions + ''} unit="chars" />
                )}
                {result.userMessage.skillsListing > 0 && (
                  <CalibrationStatCard label="技能列表" value={(result.userMessage.skillsListing / 1000).toFixed(1) + 'K'} unit="chars" />
                )}
                <CalibrationStatCard label="日期/注记" value={result.userMessage.currentDate + ''} unit="chars" />
              </div>
            </div>
          )}

          {/* Summary: normalized constants */}
          <div style={{
            border: `1px solid oklch(0.74 0.13 60 / 0.4)`, borderRadius: 13, padding: '18px 20px',
            background: 'oklch(0.74 0.13 60 / 0.08)', marginBottom: 16,
          }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: 'oklch(0.74 0.13 60)' }}>将应用的常量</h3>
            <CalibrationCategoryRows rows={resultRows} valueSize={18} withTokens onOpenDetail={openDetail} />
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
                将常量写入当前项目的 {calibrationTraceDirName(calibrationSource)} 目录
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
                <CalibrationStatCard
                  label="来源"
                  value={currentConstants.constantsSource === 'project' ? '项目校准' : currentConstants.constantsSource === 'capture' ? '抓包解析' : '内置默认'}
                />
                {currentConstants.appliedAt && (
                  <CalibrationStatCard label="校准时间" value={new Date(currentConstants.appliedAt).toLocaleString()} />
                )}
                <CalibrationStatCard label="CLI 版本" value={currentConstants.cliVersion || currentConstants.ccVersion || '-'} />
                <CalibrationStatCard label="模型" value={currentConstants.model || '-'} />
              </div>
              <div style={{ fontSize: 11, color: S.textMuted, fontFamily: MONO, wordBreak: 'break-all', marginBottom: 14 }}>
                {currentConstants.path ? `path: ${currentConstants.path}` : `cwd: ${sessionCwd}`}
              </div>
              {currentConstants.note && (
                <div style={{ fontSize: 12, color: S.textDesc3, marginBottom: 14 }}>
                  {currentConstants.note}
                </div>
              )}
              <CalibrationCategoryRows rows={currentRows} valueSize={15} onOpenDetail={openDetail} />
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
