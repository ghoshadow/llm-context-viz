import { Router } from 'express';
import { getDb } from '../db';
import { validateConfig } from '../obsidian/sync';
import { rejectUntrustedLocalRequest } from '../obsidian/local-request';

const router = Router();

const DEFAULT_NOTES_DIR = 'LLM知识卡片';
const DEFAULT_FILENAME_TEMPLATE = '第{{startTurn}}-{{endTurn}}轮 - {{title}} - {{topicHash}}.md';

interface ObsidianConfigRow {
  vault_path: string | null;
  notes_dir: string;
  filename_template: string;
}

function getConfigRow(): ObsidianConfigRow {
  const row = getDb().prepare(`
    SELECT vault_path, notes_dir, filename_template
    FROM obsidian_config
    WHERE id = 1
  `).get() as ObsidianConfigRow | undefined;

  return row || {
    vault_path: null,
    notes_dir: DEFAULT_NOTES_DIR,
    filename_template: DEFAULT_FILENAME_TEMPLATE,
  };
}

router.get('/config', (_req, res) => {
  try {
    if (rejectUntrustedLocalRequest(_req, res)) return;
    const row = getConfigRow();
    const validation = validateConfig({
      vaultPath: row.vault_path,
      notesDir: row.notes_dir,
      filenameTemplate: row.filename_template,
    });

    return res.json({
      vaultPath: row.vault_path,
      notesDir: row.notes_dir,
      filenameTemplate: row.filename_template,
      configured: validation.ok,
      error: validation.ok ? null : validation.error,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: '获取 Obsidian 配置失败: ' + message });
  }
});

router.put('/config', (req, res) => {
  try {
    if (rejectUntrustedLocalRequest(req, res)) return;
    const { vaultPath, notesDir, filenameTemplate } = req.body || {};
    const next = {
      vaultPath: typeof vaultPath === 'string' && vaultPath.trim() ? vaultPath.trim() : null,
      notesDir: typeof notesDir === 'string' && notesDir.trim() ? notesDir.trim() : DEFAULT_NOTES_DIR,
      filenameTemplate: typeof filenameTemplate === 'string' && filenameTemplate.trim()
        ? filenameTemplate.trim()
        : DEFAULT_FILENAME_TEMPLATE,
    };

    const validation = validateConfig(next);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    getDb().prepare(`
      INSERT INTO obsidian_config (id, vault_path, notes_dir, filename_template, updated_at)
      VALUES (1, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        vault_path = excluded.vault_path,
        notes_dir = excluded.notes_dir,
        filename_template = excluded.filename_template,
        updated_at = datetime('now')
    `).run(next.vaultPath, next.notesDir, validation.filenameTemplate);

    return res.json({
      vaultPath: next.vaultPath,
      notesDir: next.notesDir,
      filenameTemplate: validation.filenameTemplate,
      configured: true,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: '保存 Obsidian 配置失败: ' + message });
  }
});

export default router;
