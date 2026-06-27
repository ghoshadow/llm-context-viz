import { Router } from 'express';
import type { ExtractedConstants } from '../../src/pipeline/extract-constants';
import {
  readProjectConstants,
  writeProjectConstants,
} from '../services/calibration-constants';
import {
  cancelCalibrationJob,
  getCalibrationJob,
  startCalibrationJob,
} from '../services/calibration-job';

const router = Router();

// ── PUT /apply — save extracted constants to disk ──

router.put('/apply', (req, res) => {
  try {
    const body = req.body as { cwd?: string; summary?: ExtractedConstants['summary']; details?: ExtractedConstants['details']; ccVersion?: string; model?: string };
    if (!body.cwd) {
      return res.status(400).json({ error: '缺少 cwd 字段，无法确定当前项目。' });
    }
    if (!body.summary) {
      return res.status(400).json({ error: '缺少 summary 字段' });
    }

    const data = writeProjectConstants(body.cwd, {
      summary: body.summary,
      details: body.details,
      ccVersion: body.ccVersion,
      model: body.model,
    });
    return res.json({ ...data, ok: true, path: data.path });
  } catch (err) {
    return res.status(500).json({ error: '保存失败: ' + (err as Error).message });
  }
});

// ── GET /current — read current calibrated constants ──

router.get('/current', (_req, res) => {
  try {
    const cwd = typeof _req.query.cwd === 'string' ? _req.query.cwd : '';
    if (!cwd) {
      return res.status(400).json({ error: '缺少 cwd 参数，无法确定当前项目。' });
    }
    return res.json(readProjectConstants(cwd));
  } catch (err) {
    return res.status(500).json({ error: '读取失败: ' + (err as Error).message });
  }
});

// ── POST /auto/start — launch no-sudo calibration proxy and Claude Code ──

router.post('/auto/start', async (req, res) => {
  try {
    const job = await startCalibrationJob(req.body || {});
    return res.json(job);
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
