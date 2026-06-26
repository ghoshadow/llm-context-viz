import { Router } from 'express';
import multer from 'multer';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { extractConstants, type ExtractedConstants } from '../../src/pipeline/extract-constants';
import {
  cancelCalibrationJob,
  getCalibrationJob,
  startCalibrationJob,
} from '../services/calibration-job';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..'); // server/routes/

const upload = multer({ dest: '/tmp/claude-trace-uploads' });
const router = Router();

// Constants file path (next to compute-context.ts)
const CONSTANTS_FILE = join(__dirname, '..', '..', 'src', 'pipeline', 'system-constants.json');

// ── POST / — upload captured API log and extract constants ──

router.post('/', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '缺少文件' });
    }

    const extracted = extractConstants(req.file.path);
    if (!extracted) {
      return res.status(400).json({ error: '未找到有效的 API 请求数据。请确认文件是通过 transparent-proxy.js 截获的。' });
    }

    return res.json(extracted);
  } catch (err) {
    return res.status(500).json({ error: '解析失败: ' + (err as Error).message });
  }
});

// ── PUT /apply — save extracted constants to disk ──

router.put('/apply', (req, res) => {
  try {
    const body = req.body as { summary?: ExtractedConstants['summary']; ccVersion?: string; model?: string };
    if (!body.summary) {
      return res.status(400).json({ error: '缺少 summary 字段' });
    }

    const data = {
      appliedAt: new Date().toISOString(),
      ccVersion: body.ccVersion || 'unknown',
      model: body.model || 'unknown',
      ...body.summary,
    };

    writeFileSync(CONSTANTS_FILE, JSON.stringify(data, null, 2) + '\n');
    return res.json({ ok: true, path: CONSTANTS_FILE });
  } catch (err) {
    return res.status(500).json({ error: '保存失败: ' + (err as Error).message });
  }
});

// ── GET /current — read current calibrated constants ──

router.get('/current', (_req, res) => {
  try {
    if (existsSync(CONSTANTS_FILE)) {
      const data = JSON.parse(readFileSync(CONSTANTS_FILE, 'utf-8'));
      return res.json(data);
    }
    return res.json({
      note: '尚未校准。使用 compute-context.ts 中的硬编码常量。',
      SYS_PROMPT_FALLBACK_CHARS: 5768,
      TOOL_DEFS_FALLBACK_CHARS: 98949,
      SYSTEM_REMINDER_CHROME_CHARS: 612,
    });
  } catch (err) {
    return res.status(500).json({ error: '读取失败: ' + (err as Error).message });
  }
});

// ── POST /auto/start — launch no-sudo calibration proxy and Claude Code ──

router.post('/auto/start', async (req, res) => {
  try {
    const job = await startCalibrationJob(req.body || {});
    return res.json({ jobId: job.jobId, ...job });
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
});

// ── GET /auto/:jobId — poll automatic calibration job ──

router.get('/auto/:jobId', (req, res) => {
  const job = getCalibrationJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '校准任务不存在' });
  return res.json(job);
});

// ── POST /auto/:jobId/cancel — cancel automatic calibration job ──

router.post('/auto/:jobId/cancel', (req, res) => {
  const job = cancelCalibrationJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '校准任务不存在' });
  return res.json(job);
});

export default router;
