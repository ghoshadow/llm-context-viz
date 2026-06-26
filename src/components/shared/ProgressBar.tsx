import React from 'react';

interface ProgressBarProps {
  /** 0–100 percentage. */
  pct: number;
  /** Bar color (CSS value). */
  color?: string;
  /** Track height in px. Default 5. */
  height?: number;
  /** Bottom margin in px. Default 10. */
  marginBottom?: number;
}

/**
 * Thin animated progress bar. Eliminates the duplicated inline style pattern
 * used across OntologyPage, ContextAssembly, and TurnInspector.
 */
export default function ProgressBar({
  pct,
  color = 'oklch(0.74 0.12 165)',
  height = 5,
  marginBottom = 10,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, pct));

  return (
    <div
      style={{
        height,
        borderRadius: Math.round(height / 2),
        background: 'oklch(0.24 0.012 265)',
        overflow: 'hidden',
        marginBottom,
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: Math.round(height / 2),
          width: `${clamped}%`,
          background: color,
          transition: 'width .3s ease',
        }}
      />
    </div>
  );
}
