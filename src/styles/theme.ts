/**
 * llm-context-viz — oklch color theme extracted from prototype DC pages.
 *
 * Source files:
 *   - llm-context-manage-ui-test/Context Assembly.dc.html
 *   - llm-context-manage-ui-test/Turn Inspector.dc.html
 */

// ─── Category Colors (12 context categories) ─────────────────────────

export const COLORS: Record<string, string> = {
  toolResults: 'oklch(0.76 0.13 62)',
  toolCalls:   'oklch(0.72 0.12 42)',
  subagent:    'oklch(0.67 0.15 25)',
  thinking:    'oklch(0.78 0.10 172)',
  userMsgs:    'oklch(0.80 0.12 148)',
  asstText:    'oklch(0.74 0.09 200)',
  tools:       'oklch(0.66 0.13 274)',
  sysPrompt:   'oklch(0.62 0.14 292)',
  skills:      'oklch(0.71 0.12 256)',
  memory:      'oklch(0.73 0.10 236)',
  reminders:   'oklch(0.64 0.07 305)',
  mcp:         'oklch(0.76 0.10 246)',
};

// ─── Group Metadata (3 groups: io / convo / core) ────────────────────

export const GROUP_META: Record<string, { accent: string; label: string; desc: string }> = {
  io: {
    accent: 'oklch(0.76 0.13 60)',
    label:  '工具 I/O',
    desc:   '工具调用 · 结果 · 子 Agent 输出',
  },
  convo: {
    accent: 'oklch(0.78 0.11 158)',
    label:  '对话内容',
    desc:   '用户轮次 · 助手回复 · 推理',
  },
  core: {
    accent: 'oklch(0.70 0.12 268)',
    label:  '脚手架',
    desc:   '系统提示词 · 工具 · 技能 · 记忆',
  },
};

// ─── Growth Chart Colors ─────────────────────────────────────────────

export const CHART_COLORS = {
  assembled: 'oklch(0.74 0.13 58)',
  billed:    'oklch(0.72 0.10 200)',
  output:    'oklch(0.78 0.10 172)',
  total:     'oklch(0.90 0.02 265)',
  refLine:   'oklch(0.62 0.10 30)',
} as const;

// ─── Execution Timeline Step Colors ───────────────────────────────────

export const STEP_COLORS = {
  model:    'oklch(0.78 0.10 172)',  // green — model generation
  tool:     'oklch(0.76 0.13 62)',   // amber — tool execution
  subagent: 'oklch(0.67 0.15 25)',   // orange — sub-agent wait
} as const;

// ─── Semantic CSS Variables ──────────────────────────────────────────

export const SEMANTIC: Record<string, string> = {
  // Page / Surface
  pageBg:       'oklch(0.155 0.008 265)',
  cardBg:       'oklch(0.185 0.009 265 / 0.7)',
  cardBgHover:  'oklch(0.20 0.01 265 / 0.6)',      // button / card hover tint
  innerCardBg:  'oklch(0.20 0.01 265 / 0.5)',      // nested stat card background

  // Selection
  selectionBg: 'oklch(0.74 0.13 60 / 0.30)',

  // Radial gradient stop
  radialGradientStop: 'oklch(0.22 0.03 285 / 0.45)',

  // Borders
  borderColor:    'oklch(0.30 0.014 265)',
  borderSubtle:   'oklch(0.26 0.012 265)',           // Thin separators (legend rows)
  borderSubtle2:  'oklch(0.26 0.012 265 / 0.6)',     // Slightly transparent variant
  borderSubtle3:  'oklch(0.26 0.012 265 / 0.55)',    // Legend row separator
  borderBarBg:    'oklch(0.32 0.014 265)',           // Hero/timeline bar border
  borderAccent:   'oklch(0.45 0.10 60)',             // Amber accent border
  borderOk:       'oklch(0.45 0.08 150 / 0.4)',      // Ok/check border
  borderInner:    'oklch(0.28 0.012 265)',           // Inner stat-card border
  borderTip:      'oklch(0.40 0.014 265)',           // Tooltip border
  borderInput:    'oklch(0.26 0.012 265)',           // Prompt input bg border

  // Bar internals
  barBg:          'oklch(0.24 0.01 265)',            // Progress bar track
  barInsetBoxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.04)',
  barSeparator:   'oklch(0.16 0.008 265 / 0.5)',    // Segment divider
  barSeparator2:  'oklch(0.16 0.008 265 / 0.45)',   // Lighter segment divider
  freeStripes:    'repeating-linear-gradient(135deg, oklch(0.26 0.012 265) 0 7px, oklch(0.18 0.01 265) 7px 14px)',

  // Donut center
  donutCenter:   'oklch(0.185 0.012 265)',

  // Text
  textPrimary:   'oklch(0.93 0.006 265)',
  textPrimary2:  'oklch(0.92 0.01 265)',
  textPrimary3:  'oklch(0.90 0.01 265)',
  textPrimary4:  'oklch(0.88 0.01 265)',
  textPrimary5:  'oklch(0.86 0.01 265)',
  textPrimary6:  'oklch(0.84 0.01 265)',
  textPrimary7:  'oklch(0.82 0.01 265)',
  textSecondary: 'oklch(0.70 0.012 265)',
  textMuted:     'oklch(0.55 0.012 265)',
  textMuted2:    'oklch(0.52 0.012 265)',
  textMuted3:    'oklch(0.50 0.012 265)',
  textMuted4:    'oklch(0.46 0.012 265)',
  textAccent:    'oklch(0.74 0.13 60)',               // Amber accent text (peak tokens, etc.)
  textAccent2:   'oklch(0.82 0.10 60)',               // Warm amber for links/buttons
  textAccent3:   'oklch(0.80 0.12 60)',               // Selected item num
  textAccent4:   'oklch(0.76 0.13 60)',               // Peak value highlight
  textGreen:     'oklch(0.78 0.10 150)',              // Ok/check overflow text
  textGreen2:    'oklch(0.78 0.12 145)',              // "High" compression label
  textRef:       'oklch(0.66 0.10 30)',               // Reference line label
  textDesc:      'oklch(0.62 0.012 265)',
  textDesc2:     'oklch(0.60 0.012 265)',
  textDesc3:     'oklch(0.58 0.012 265)',
  textDesc4:     'oklch(0.56 0.012 265)',
  textDesc5:     'oklch(0.54 0.012 265)',
  textDesc6:     'oklch(0.64 0.012 265)',             // Badge label
  textDesc7:     'oklch(0.66 0.012 265)',             // Subtitle
  textMiniLabel: 'oklch(0.58 0.012 265)',             // Mini label (model / requests / etc.)
};

// ─── Overflow Warning Colors ─────────────────────────────────────────

export const OVERFLOW = {
  text:    'oklch(0.82 0.10 60)',
  bg:      'oklch(0.74 0.13 60 / 0.10)',
  border:  'oklch(0.50 0.10 60 / 0.5)',
} as const;

// ─── Ok State Colors ─────────────────────────────────────────────────

export const OK_STATE = {
  text:    'oklch(0.78 0.10 150)',
  bg:      'oklch(0.70 0.12 150 / 0.08)',
  border:  'oklch(0.45 0.08 150 / 0.4)',
} as const;

// ─── Selected / Active List Item ──────────────────────────────────────

export const SELECTED_ITEM = {
  bg:        'oklch(0.26 0.02 60 / 0.30)',
  loadColor: 'oklch(0.76 0.13 60)',
  border:    'oklch(0.55 0.10 60)',
} as const;

// ─── Unselected List Item ─────────────────────────────────────────────

export const UNSELECTED_ITEM = {
  bg:        'oklch(0.20 0.01 265 / 0.4)',
  loadColor: 'oklch(0.42 0.03 265)',
  border:    'oklch(0.28 0.012 265)',
} as const;

// ─── Step Selected Highlight ──────────────────────────────────────────

export const STEP_SELECTED = {
  bg:     'oklch(0.26 0.02 60 / 0.28)',
  border: 'oklch(0.45 0.08 60)',
} as const;

// ─── Error Highlight ──────────────────────────────────────────────────

export const ERROR_COLOR = 'oklch(0.67 0.18 25)';
export const ERROR_TEXT  = 'oklch(0.6 0 0)';

// ─── Labels (Chinese) ─────────────────────────────────────────────────

export const LABELS: Record<string, string> = {
  toolResults: '工具结果',
  thinking:    '助手推理',
  tools:       '工具定义',
  skills:      '技能（Skills）',
  toolCalls:   '工具调用',
  userMsgs:    '用户消息',
  asstText:    '助手回复',
  sysPrompt:   '系统提示词',
  memory:      '记忆（CLAUDE.md）',
  reminders:   '提醒与元信息',
  subagent:    '子 Agent（Task）',
  mcp:         'MCP 指令',
};

// ─── Delta Labels (subset used in Turn Inspector delta panel) ─────────

export const DELTA_LABELS: Record<string, string> = {
  toolResults: '工具结果',
  thinking:    '助手推理',
  toolCalls:   '工具调用',
  userMsgs:    '用户消息',
  asstText:    '助手回复',
  subagent:    '子 Agent（Task）',
};

// ─── Window Constant ──────────────────────────────────────────────────

export const WINDOW = 200000;
