import { useState, useEffect, useCallback } from 'react';
import { SEMANTIC } from '../../styles/theme';
import { get, put } from '../../api/client';

interface ModelConfigData {
  LLM_BASE_URL: string;
  LLM_API_KEY: string;
  LLM_MODEL: string;
  TRANSLATION_BASE_URL: string;
  TRANSLATION_MODEL: string;
  hasApiKey: boolean;
}

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 2000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'oklch(0 0 0 / 0.55)', backdropFilter: 'blur(6px)',
  },
  card: {
    width: 460, maxWidth: 'calc(100vw - 48px)', maxHeight: '85vh',
    padding: '28px 28px 24px', borderRadius: 12,
    background: SEMANTIC.cardBg, border: `1px solid ${SEMANTIC.borderColor}`,
    boxShadow: '0 16px 48px oklch(0 0 0 / 0.45)',
  },
  title: { margin: 0, fontSize: 16, fontWeight: 600, color: SEMANTIC.textPrimary },
  sub: { fontSize: 12, color: SEMANTIC.textMuted, marginTop: 4 },
  form: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 },
  group: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11.5, fontWeight: 600, color: SEMANTIC.textSecondary, fontFamily: "'IBM Plex Mono', monospace" as string },
  input: {
    padding: '8px 12px', borderRadius: 6, fontSize: 13,
    border: `1px solid ${SEMANTIC.borderColor}`,
    background: 'oklch(0.15 0.008 265)', color: SEMANTIC.textPrimary,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  hint: { fontSize: 10.5, color: SEMANTIC.textMuted },
  expandBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: SEMANTIC.textAccent2, fontSize: 11.5, padding: 0, textAlign: 'left' as const,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 },
  btnPrimary: {
    padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 500,
    background: 'oklch(0.74 0.13 60 / 0.18)', color: SEMANTIC.textAccent2,
    border: `1px solid oklch(0.50 0.10 60 / 0.4)`, cursor: 'pointer',
  },
  btnCancel: {
    padding: '8px 20px', borderRadius: 6, fontSize: 13,
    background: 'transparent', color: SEMANTIC.textSecondary,
    border: `1px solid ${SEMANTIC.borderColor}`, cursor: 'pointer',
  },
  saving: { fontSize: 11, color: SEMANTIC.textAccent2, alignSelf: 'center' },
};

interface Props {
  onClose: () => void;
}

export default function ModelConfigModal({ onClose }: Props) {
  const [config, setConfig] = useState<ModelConfigData | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const data = await get<ModelConfigData>('/config/model');
    setConfig(data);
    setForm({
      LLM_BASE_URL: data.LLM_BASE_URL || '',
      LLM_API_KEY: '',                         // 不回显
      LLM_MODEL: data.LLM_MODEL || '',
      TRANSLATION_BASE_URL: data.TRANSLATION_BASE_URL || '',
      TRANSLATION_MODEL: data.TRANSLATION_MODEL || '',
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      const body: Record<string, string> = {};
      for (const k of ['LLM_BASE_URL', 'LLM_MODEL', 'TRANSLATION_BASE_URL', 'TRANSLATION_MODEL']) {
        if (form[k]?.trim()) body[k] = form[k]!.trim();
      }
      // 只在用户输入了新的 key 时才发送
      if (form.LLM_API_KEY?.trim()) body.LLM_API_KEY = form.LLM_API_KEY.trim();

      const data = await put<ModelConfigData>('/config/model', body);
      setMsg('保存成功');
      setConfig(data);
      setForm((prev) => ({ ...prev, LLM_API_KEY: '' }));  // 清空输入
    } catch {
      setMsg('网络错误');
    } finally {
      setSaving(false);
    }
  };

  const keyInputPlaceholder = config?.hasApiKey ? '已设置 (输入新值覆盖)' : '输入 API Key';

  return (
    <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.card}>
        <h2 style={S.title}>模型配置</h2>
        <p style={S.sub}>配置保存到 ~/.llm-context-viz/.env，立即生效</p>

        <div style={S.form}>
          {/* API Key */}
          <div style={S.group}>
            <label style={S.label}>LLM_API_KEY</label>
            <input
              style={S.input}
              type="password"
              value={form.LLM_API_KEY || ''}
              placeholder={keyInputPlaceholder}
              onChange={(e) => handleChange('LLM_API_KEY', e.target.value)}
              autoComplete="off"
            />
            {config?.hasApiKey && <span style={S.hint}>当前: {config.LLM_API_KEY}</span>}
          </div>

          {/* Base URL */}
          <div style={S.group}>
            <label style={S.label}>LLM_BASE_URL</label>
            <input
              style={S.input}
              value={form.LLM_BASE_URL || ''}
              placeholder="https://api.deepseek.com/anthropic"
              onChange={(e) => handleChange('LLM_BASE_URL', e.target.value)}
            />
          </div>

          {/* Model */}
          <div style={S.group}>
            <label style={S.label}>LLM_MODEL</label>
            <input
              style={S.input}
              value={form.LLM_MODEL || ''}
              placeholder="deepseek-v4-pro"
              onChange={(e) => handleChange('LLM_MODEL', e.target.value)}
            />
          </div>

          {/* Expand: translation config */}
          <button style={S.expandBtn} onClick={() => setExpanded(!expanded)}>
            {expanded ? '▾ 收起翻译配置' : '▸ 翻译配置（可选）'}
          </button>

          {expanded && (
            <>
              <div style={S.group}>
                <label style={S.label}>TRANSLATION_BASE_URL</label>
                <input
                  style={S.input}
                  value={form.TRANSLATION_BASE_URL || ''}
                  placeholder="默认使用 LLM_BASE_URL"
                  onChange={(e) => handleChange('TRANSLATION_BASE_URL', e.target.value)}
                />
              </div>
              <div style={S.group}>
                <label style={S.label}>TRANSLATION_MODEL</label>
                <input
                  style={S.input}
                  value={form.TRANSLATION_MODEL || ''}
                  placeholder="默认使用 LLM_MODEL"
                  onChange={(e) => handleChange('TRANSLATION_MODEL', e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div style={S.footer}>
          {msg && <span style={S.saving}>{msg}</span>}
          <button style={S.btnCancel} onClick={onClose}>取消</button>
          <button style={S.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
