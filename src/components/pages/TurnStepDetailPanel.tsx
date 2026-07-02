import { useEffect, useState, useCallback } from 'react';
import { get, post } from '../../api/client';
import { useSessionStore } from '../../store/sessionStore';
import { SEMANTIC, STEP_COLORS, ERROR_COLOR, ERROR_TEXT } from '../../styles/theme';
import { fmt, fmtDur } from '../../utils/format';
import { ContentRenderer } from '../shared/ContentRenderer';
import { StructuredTextBlock } from '../shared/StructuredTextBlock';
import { hasStructuredText } from '../shared/structuredText';
import type { SegmentDetail, TimelineSegment } from '../../types/session';
import { segColor } from './turnInspectorLogic';

/** Max height for collapsed content blocks. */
const COLLAPSED_H = 180;

// ============================================================================
// Step Detail Panel
// ============================================================================

interface SubAgentInfo {
  file: string;
  model: string;
  prompt: string;
  asstCount: number;
  durMs: number;
  toolCalls: string[];
}

function SubAgentSummary({ subAgents }: { subAgents: SubAgentInfo[] }) {
  return (
    <div className="content-block">
      <div className="block-header">
        <span style={{ width: 7, height: 7, borderRadius: 2, background: 'oklch(0.67 0.15 25)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: SEMANTIC.textPrimary4 }}>
          并行子Agent · {subAgents.length} 个
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' }}>
        {subAgents.map((sa, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
            borderRadius: 6, background: 'oklch(0.185 0.009 265 / 0.5)',
            border: `1px solid ${SEMANTIC.borderSubtle1}`,
          }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'oklch(0.67 0.15 25)', fontWeight: 600, flexShrink: 0, width: 20 }}>
              #{i + 1}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: SEMANTIC.textPrimary3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {sa.prompt || sa.file.replace('.jsonl','')}
              </span>
              <span style={{ fontSize: 10.5, color: SEMANTIC.textMuted, marginTop: 1, display: 'block' }}>
                {sa.model} · {sa.asstCount} 次调用 · {fmtDur(sa.durMs)} · 工具: {sa.toolCalls.join(', ') || '无'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserPromptSection({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="content-block">
      <div className="block-header">
        <span style={{ width: 7, height: 7, borderRadius: 2, background: 'oklch(0.80 0.12 148)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: SEMANTIC.textPrimary4 }}>用户输入</span>
        <span style={{ flex: 1 }} />
        <span onClick={copy} style={{ padding: '1px 6px', fontSize: 10, cursor: 'pointer', color: copied ? SEMANTIC.textGreen : SEMANTIC.textMuted2, fontFamily: "'IBM Plex Sans', sans-serif" }}>
          {copied ? '已复制' : '复制'}
        </span>
      </div>
      {hasStructuredText(prompt) ? (
        <StructuredTextBlock
          text={prompt}
          fontFamily="'IBM Plex Sans', system-ui, sans-serif"
          fontSize={13}
          maxHeight={open ? 'none' : COLLAPSED_H}
          overflowY={open ? 'visible' : 'auto'}
        />
      ) : (
        <ContentRenderer
          text={prompt}
          fontFamily="'IBM Plex Sans', system-ui, sans-serif"
          fontSize={13}
          maxHeight={open ? 'none' : COLLAPSED_H}
          overflowY={open ? 'visible' : 'auto'}
          markdown
        />
      )}
      <div className={`content-collapse-toggle${open ? '' : ' attached'}`} onClick={() => setOpen((value) => !value)}>
        <span>{open ? '收起' : '展开剩余内容'}</span>
      </div>
    </div>
  );
}

interface StepDetailPanelProps {
  seg: TimelineSegment | null;
  index: number | null;
  prompt: string;
}

export function TurnStepDetailPanel({ seg, index, prompt }: StepDetailPanelProps) {
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [translating, setTranslating] = useState<Record<number, boolean>>({});
  const [showOriginal, setShowOriginal] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState<Set<number>>(new Set());
  const sessionId = useSessionStore((s) => s.currentSessionId);
  const turnIndex = useSessionStore((s) => s.currentTurnIndex);
  const stepIndex = index;

  // Load cached translations when turn/step changes
  useEffect(() => {
    if (sessionId == null || turnIndex == null || stepIndex == null) return;
    let cancelled = false;
    get<{ translations: Record<string, Record<string, string>> }>(`/sessions/${sessionId}/translations/${turnIndex}`)
      .then((res) => {
        if (!cancelled && res.translations?.[String(stepIndex)]) {
          setTranslations(res.translations[String(stepIndex)]!);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, turnIndex, stepIndex]);

  // Reset non-cached state when switching steps
  useEffect(() => {
    setTranslations({});
    setTranslating({});
    setShowOriginal({});
  }, [index]);

  const handleCopy = useCallback(async (text: string, key: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied((p) => new Set(p).add(key));
      setTimeout(() => setCopied((p) => { const n = new Set(p); n.delete(key); return n; }), 2000);
    } catch { /* clipboard unavailable */ }
  }, []);

  const handleTranslate = useCallback(async (si: number, text: string) => {
    if (translations[si] || translating[si]) return;
    // Quick check: strip code blocks and inline code; if nothing translatable remains, skip
    const stripped = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, '').trim();
    if (!stripped) {
      setTranslations((p) => ({ ...p, [si]: '代码内容不支持翻译' }));
      return;
    }
    setTranslating((p) => ({ ...p, [si]: true }));
    try {
      const res = await post<{ translated: string }>(`/sessions/${sessionId}/translate`, { text, turnIndex, stepIndex, sectionIndex: si });
      setTranslations((p) => ({ ...p, [si]: res.translated }));
    } catch { /* silently ignore */ }
    finally { setTranslating((p) => ({ ...p, [si]: false })); }
  }, [sessionId, translations, translating]);

  if (!seg || index === null) {
    if (prompt) {
      return (
        <div style={{ marginTop: 16, borderTop: `1px solid ${SEMANTIC.borderSubtle2}`, paddingTop: 16 }}>
          <UserPromptSection prompt={prompt} />
        </div>
      );
    }

    return (
      <div style={{ marginTop: 16, borderTop: `1px solid ${SEMANTIC.borderSubtle2}`, paddingTop: 16 }}>
        <div style={{ fontSize: 12.5, color: SEMANTIC.textDesc4, lineHeight: 1.6 }}>
          点击上方甘特图或步骤列表中的任一时间节点，查看该步骤的上下文内容（思考过程 / 工具调用参数 / 返回结果）。
        </div>
      </div>
    );
  }

  const d: SegmentDetail = seg.det ?? {};
  const SANS = "'IBM Plex Sans', sans-serif";
  const MONO = "'IBM Plex Mono', monospace";

  const tf = (() => {
    const tt = new Date(seg.ts);
    if (isNaN(tt.getTime())) return '';
    return `${String(tt.getHours()).padStart(2, '0')}:${String(tt.getMinutes()).padStart(2, '0')}:${String(tt.getSeconds()).padStart(2, '0')}`;
  })();

  interface Section {
    label: string;
    accent: string;
    font: string;
    meta: string;
    body: string;
    /** When true, render body as Markdown. */
    md?: boolean;
    /** Language tag for syntax-highlighted code rendering (e.g. 'json'). */
    lang?: string;
    /** Tool name for diff rendering (e.g. 'Edit'). */
    toolName?: string;
    /** When true, preserve line breaks within each paragraph. */
    preserveNewlines?: boolean;
  }

  const sections: Section[] = [];

  if (seg.k === 'i') {
    sections.push({
      label: seg.n,
      accent: segColor(seg.k),
      font: SANS,
      meta: '',
      body: d.text ?? '该步骤为会话内系统事件。',
      md: true,
    });
  } else if (seg.k === 'm') {
    if (d.think) {
      sections.push({
        label: '思考过程',
        accent: STEP_COLORS.model,
        font: SANS,
        meta: `${fmt(d.thinkTok ?? 0)} tok`,
        body: d.think,
        md: true,
      });
    }
    if (d.text) {
      sections.push({
        label: '回复文本',
        accent: 'oklch(0.74 0.09 200)',
        font: SANS,
        meta: `${fmt(d.textTok ?? 0)} tok`,
        body: d.text,
        md: true,
      });
    }
    (d.calls ?? []).forEach((c) => {
      sections.push({
        label: `工具调用 · ${c.name}`,
        accent: STEP_COLORS.tool,
        font: MONO,
        meta: `${fmt(c.tok)} tok`,
        body: c.input,
        lang: 'json',
        toolName: c.name,
      });
    });
    if (!sections.length) {
      sections.push({
        label: '（空响应）',
        accent: ERROR_TEXT,
        font: SANS,
        meta: '',
        body: '该响应不包含任何内容块。',
      });
    }
  } else {
    if (d.input) {
      sections.push({
        label: `调用参数 · ${d.name ?? seg.n}`,
        accent: STEP_COLORS.tool,
        font: MONO,
        meta: '',
        body: d.input,
        lang: 'json',
        toolName: d.name,
      });
    }
    sections.push({
      label: d.isError ? '返回结果 · 错误' : '返回结果',
      accent: d.isError ? ERROR_COLOR : STEP_COLORS.tool,
      font: MONO,
      meta: `${fmt(d.resultTok ?? 0)} tok`,
      body: d.result ?? '（空）',
      md: !d.isError,
      preserveNewlines: !d.isError,
    });
  }

  const title = seg.k === 'i' ? seg.n || '等待用户输入'
    : seg.k === 'm'
    ? (d.think ? '模型生成 · thinking' : d.text ? '模型生成 · text' : d.calls ? '模型生成 · tool_use' : '模型生成')
    : `${seg.k === 's' ? '子Agent · ' : '工具 · '}${seg.n}`;

  const tokLine = seg.k === 'i'
    ? '系统事件'
    : seg.k === 'm'
    ? `输入 ${fmt(d.inTok ?? 0)} · 输出 ${fmt(d.outTok ?? 0)} tok`
    : `结果 ${fmt(d.resultTok ?? 0)} tok`;

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${SEMANTIC.borderSubtle2}`, paddingTop: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 13,
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textMuted3 }}>
          #{String(index + 1).padStart(2, '0')}
        </span>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: segColor(seg.k) }} />
        <span style={{ fontSize: 14.5, fontWeight: 600, color: SEMANTIC.textPrimary2 }}>
          {title}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: SEMANTIC.textDesc3 }}>
          {tf} · 耗时 {fmtDur(seg.ms)} · {tokLine}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {prompt && <UserPromptSection prompt={prompt} />}
        {/* Sub-agent summary — shown before detail sections when subAgents present */}
        {d.subAgents && d.subAgents.length > 0 && (
          <SubAgentSummary subAgents={d.subAgents} />
        )}
        {sections.map((sec, si) => (
          <div key={si} className="content-block">
            <div className="block-header">
              <span style={{ width: 7, height: 7, borderRadius: 2, background: sec.accent, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: SEMANTIC.textPrimary4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sec.label}>
                {sec.label}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: SEMANTIC.textMuted2 }}>
                {sec.meta}
              </span>
              {sec.body && (
                <span
                  onClick={() => handleCopy(showOriginal[si] ? sec.body : (translations[si] || sec.body), si)}
                  style={{
                    marginLeft: 8, padding: '1px 6px', fontSize: 10, cursor: 'pointer',
                    color: copied.has(si) ? SEMANTIC.textGreen : SEMANTIC.textMuted2,
                    fontFamily: "'IBM Plex Sans', sans-serif",
                  }}
                >
                  {copied.has(si) ? '已复制' : '复制'}
                </span>
              )}
              {sec.md && sec.body && (
                (() => {
                  const isCodeOnly = translations[si] === '代码内容不支持翻译';
                  return (
                <button
                  onClick={() => handleTranslate(si, sec.body)}
                  disabled={translating[si] || isCodeOnly}
                  style={{
                    marginLeft: 8,
                    padding: '1px 8px',
                    fontSize: 10,
                    fontFamily: "'IBM Plex Sans', sans-serif",
                    color: isCodeOnly ? SEMANTIC.textMuted2
                         : translations[si] ? SEMANTIC.textGreen : SEMANTIC.textAccent2,
                    background: isCodeOnly ? 'oklch(0.30 0.012 265 / 0.4)'
                              : translations[si] ? 'oklch(0.55 0.08 150 / 0.10)' : 'oklch(0.45 0.10 60 / 0.08)',
                    border: `1px solid ${isCodeOnly ? 'oklch(0.30 0.012 265 / 0.3)'
                              : translations[si] ? 'oklch(0.45 0.08 150 / 0.3)' : 'oklch(0.45 0.10 60 / 0.15)'}`,
                    borderRadius: 4,
                    cursor: isCodeOnly ? 'default' : translating[si] ? 'wait' : 'pointer',
                    opacity: translating[si] ? 0.6 : 1,
                  }}
                >
                  {translating[si] ? '翻译中...' : isCodeOnly ? '不可翻译' : translations[si] ? '✓ 已翻译' : '翻译'}
                </button>
                  );
                })()
              )}
              {translations[si] && translations[si] !== '代码内容不支持翻译' && (
                <button
                  onClick={() => setShowOriginal((p) => ({ ...p, [si]: !p[si] }))}
                  style={{
                    marginLeft: 4,
                    padding: '1px 8px',
                    fontSize: 10,
                    fontFamily: "'IBM Plex Sans', sans-serif",
                    color: showOriginal[si] === false ? SEMANTIC.textPrimary : SEMANTIC.textMuted2,
                    background: showOriginal[si] === false ? 'oklch(0.34 0.014 265 / 0.5)' : 'oklch(0.26 0.012 265 / 0.5)',
                    border: '1px solid oklch(0.32 0.014 265 / 0.5)',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {showOriginal[si] === false ? '显示原文' : '隐藏原文'}
                </button>
              )}
            </div>
            {(!translations[si] || showOriginal[si] !== false) && (() => {
              const isOpen = expanded.has(si);
              const isExpandable = (sec.md || sec.lang) && sec.body;
              const maxH = isExpandable && !isOpen ? COLLAPSED_H : 'none';
              const ovf = isExpandable && !isOpen ? 'auto' : 'visible';

              return (
                <>
                  <ContentRenderer
                    text={sec.body}
                    fontFamily={sec.font}
                    fontSize={12}
                    maxHeight={maxH}
                    overflowY={ovf as 'auto' | 'visible'}
                    markdown={Boolean(sec.md)}
                    language={sec.lang}
                    toolName={sec.toolName}
                    preserveNewlines={sec.preserveNewlines}
                  />
                  {isExpandable && (
                    <div
                      className="content-collapse-toggle"
                      onClick={() => setExpanded((p) => {
                        const n = new Set(p);
                        isOpen ? n.delete(si) : n.add(si);
                        return n;
                      })}
                    >
                      <span>{isOpen ? '收起' : '展开剩余内容'}</span>
                    </div>
                  )}
                </>
              );
            })()}
            {translations[si] && (() => {
              if (translations[si] === '代码内容不支持翻译') {
                return (
              <div style={{ marginTop: 8 }}>
                <ContentRenderer
                  text="⚠ 代码内容不支持翻译"
                  fontFamily={sec.font}
                  fontSize={12}
                  tone="warning"
                />
              </div>
                );
              }
              return (
                <div className="block-body translation-block" style={{ fontFamily: sec.font }}>
                  <div className="translation-title">中文翻译</div>
                  <ContentRenderer text={translations[si]!} fontFamily={sec.font} fontSize={12} markdown />
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
