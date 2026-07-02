import { SEMANTIC } from '../../styles/theme';
import type { OntologyEvidence } from '../../types/ontology';
import { sourceLabel } from './ontologyDetailLogic';

export function EntityEvidenceSection({
  confidence,
  confidenceColor,
  status,
  confidenceNotes,
  orderedEvidence,
}: {
  confidence: number;
  confidenceColor: string;
  status: { label: string; color: string };
  confidenceNotes: string[];
  orderedEvidence: OntologyEvidence[];
}) {
  const evidenceTurnCount = new Set(orderedEvidence.map((ev) => ev.turn)).size;

  return (
    <>
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
          <span style={{ fontSize: 11.5, color: SEMANTIC.textDesc3 }}>抽取置信度</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10.5, color: status.color, border: `1px solid ${status.color}`, borderRadius: 999, padding: '1px 7px' }}>
              {status.label}
            </span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: confidenceColor }}>
              {Math.round(confidence * 100)}%
            </span>
          </div>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: 'oklch(0.24 0.01 265)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.round(confidence * 100)}%`,
              borderRadius: 4,
              background: confidenceColor,
            }}
          />
        </div>
        <div style={{
          marginTop: 8,
          border: '1px solid oklch(0.28 0.012 265)',
          borderRadius: 8,
          padding: '8px 9px',
          background: 'oklch(0.18 0.008 265 / 0.48)',
          color: SEMANTIC.textMuted,
          fontSize: 11.5,
          lineHeight: 1.55,
        }}>
          <div style={{ color: SEMANTIC.textDesc, marginBottom: 4 }}>
            由证据来源、复现轮次、片段质量和封顶规则综合计算；不是模型原始自评分。
          </div>
          {confidenceNotes.map((note) => (
            <div key={note}>· {note}</div>
          ))}
        </div>
      </div>

      {orderedEvidence.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11.5, color: SEMANTIC.textDesc3, marginBottom: 7 }}>
            证据 · {evidenceTurnCount}轮 · {orderedEvidence.length}条
          </div>
          <div style={{ fontSize: 11, color: SEMANTIC.textMuted, lineHeight: 1.45, marginBottom: 7 }}>
            支撑权重表示该原文片段对当前节点的匹配和支撑强度，不是节点整体置信度。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {orderedEvidence.map((ev, idx) => (
              <div
                key={`${ev.turn}-${ev.source}-${idx}`}
                style={{
                  border: '1px solid oklch(0.27 0.012 265)',
                  borderRadius: 8,
                  padding: '8px 9px',
                  background: SEMANTIC.innerCardBg,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'oklch(0.70 0.08 165)' }}>
                    第{ev.turn}轮
                  </span>
                  <span style={{ fontSize: 10, color: 'oklch(0.58 0.012 265)' }}>
                    {sourceLabel(ev.source)}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: SEMANTIC.textMuted }}>
                    支撑权重 {Math.round(ev.weight * 100)}%
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'oklch(0.76 0.01 265)', lineHeight: 1.45 }}>
                  {ev.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
