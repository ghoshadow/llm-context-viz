import { SEMANTIC } from '../../styles/theme';
import type { ContextAssemblyData } from './contextAssemblyData';

export function ContextAssemblyBreakdown({
  derived,
}: {
  derived: ContextAssemblyData;
}) {
  return (
    <>
      <section
        style={{
          marginTop: 30,
          display: 'grid',
          gridTemplateColumns: '1.15fr 1fr',
          gap: 22,
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 16,
            padding: '20px 20px 22px',
            background: SEMANTIC.cardBg,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '-0.01em',
              }}
            >
              各模块 Token 占用
            </h2>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: SEMANTIC.textDesc5,
              }}
            >
              面积 = Token 数
            </span>
          </div>
          <div
            onMouseLeave={derived.clearHover}
            style={{
              position: 'relative',
              width: '100%',
              height: 330,
              overflow: 'hidden',
              borderRadius: 8,
            }}
          >
            {derived.treeCells.map((c) => (
              <div
                key={c.key}
                onMouseEnter={c.onEnter}
                style={{
                  position: 'absolute',
                  left: `${c.left}%`,
                  top: `${c.top}%`,
                  width: `${c.w}%`,
                  height: `${c.h}%`,
                  padding: 2,
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 7,
                    background: c.color,
                    opacity: c.op,
                    transition: 'opacity .18s ease',
                    padding: `${c.innerPadV}px ${c.innerPadH}px`,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div
                    style={{
                      fontSize: c.labelSize,
                      fontWeight: 600,
                      lineHeight: 1.15,
                      color: 'oklch(0.16 0.02 265)',
                      opacity: c.labelOp,
                    }}
                  >
                    {c.label}
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'oklch(0.16 0.02 265 / 0.85)',
                      opacity: c.valOp,
                    }}
                  >
                    {c.pctFmt}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${SEMANTIC.borderColor}`,
            borderRadius: 16,
            padding: '20px 22px',
            background: SEMANTIC.cardBg,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 6,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              模块明细
              <span className="estimate-badge">估算</span>
            </h2>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: SEMANTIC.textDesc5,
              }}
            >
              占 {derived.peakTokensFmt} 的比例
            </span>
          </div>
          <div
            onMouseLeave={derived.clearHover}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {derived.legendRows.map((r) => (
              <div
                key={r.key}
                onMouseEnter={r.onEnter}
                style={{
                  padding: '9px 0',
                  borderBottom: `1px solid ${SEMANTIC.borderSubtle3}`,
                  opacity: r.op,
                  transition: 'opacity .18s ease',
                  cursor: 'default',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: 3,
                      background: r.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      flex: 1,
                    }}
                  >
                    {r.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: SEMANTIC.textMuted,
                    }}
                  >
                    {r.tokensFmt}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                      color: SEMANTIC.textDesc,
                      width: 65,
                      textAlign: 'right',
                    }}
                  >
                    {r.pctFmt}
                  </span>
                </div>
                <div
                  style={{
                    height: 4,
                    borderRadius: 3,
                    background: 'oklch(0.26 0.01 265)',
                    marginTop: 7,
                    marginLeft: 21,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${r.barPct}%`,
                      background: r.color,
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2
          style={{
            margin: '0 0 16px',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: SEMANTIC.textDesc2,
          }}
        >
          上下文的三个层次
          <span className="estimate-badge">估算</span>
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 18,
          }}
        >
          {derived.groups.map((g) => (
            <div
              key={g.key}
              style={{
                border: `1px solid ${SEMANTIC.borderColor}`,
                borderRadius: 16,
                padding: 20,
                background: SEMANTIC.cardBg,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    position: 'relative',
                    width: 88,
                    height: 88,
                    flexShrink: 0,
                    borderRadius: '50%',
                    background: g.conic,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 13,
                      borderRadius: '50%',
                      background: SEMANTIC.donutCenter,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 15,
                        fontWeight: 600,
                        color: g.accent,
                      }}
                    >
                      {g.pctFmt}
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>
                    {g.label}
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                      color: SEMANTIC.textSecondary,
                      marginTop: 3,
                    }}
                  >
                    {g.tokensFmt}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: SEMANTIC.textDesc4,
                      marginTop: 5,
                      lineHeight: 1.35,
                    }}
                  >
                    {g.desc}
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                }}
              >
                {g.members.map((m) => (
                  <div
                    key={m.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: m.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, color: 'oklch(0.80 0.01 265)' }}>
                      {m.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        color: SEMANTIC.textMiniLabel,
                      }}
                    >
                      {m.pctFmt}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
