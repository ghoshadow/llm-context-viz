import { Router } from 'express';
import { homedir } from 'os';
import { readModelConfig, writeModelConfig } from '../services/env-file';

const router = Router();

/** GET /api/config/model — 读取模型配置（Key 掩码） */
router.get('/model', (_req, res) => {
  try {
    res.json(readModelConfig());
  } catch (err) {
    res.status(500).json({ error: '读取配置失败' });
  }
});

/** PUT /api/config/model — 更新模型配置，写入 .env */
router.put('/model', (req, res) => {
  try {
    const body = req.body || {};
    const updates: Record<string, string> = {};

    if (typeof body.LLM_BASE_URL === 'string' && body.LLM_BASE_URL.trim()) {
      updates.LLM_BASE_URL = body.LLM_BASE_URL.trim();
    }
    if (typeof body.LLM_API_KEY === 'string' && body.LLM_API_KEY.trim()) {
      updates.LLM_API_KEY = body.LLM_API_KEY.trim();
    }
    if (typeof body.LLM_MODEL === 'string' && body.LLM_MODEL.trim()) {
      updates.LLM_MODEL = body.LLM_MODEL.trim();
    }
    if (typeof body.TRANSLATION_BASE_URL === 'string') {
      updates.TRANSLATION_BASE_URL = body.TRANSLATION_BASE_URL.trim();
    }
    if (typeof body.TRANSLATION_MODEL === 'string') {
      updates.TRANSLATION_MODEL = body.TRANSLATION_MODEL.trim();
    }

    const result = writeModelConfig(updates);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '保存配置失败' });
  }
});

/** GET /api/config/home — 返回用户 home 目录（前端用于路径显示） */
router.get('/home', (_req, res) => {
  res.json({ homeDir: homedir() });
});

export default router;
