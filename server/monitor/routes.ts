/**
 * routes.ts — 监控 API 路由。
 *
 * GET /api/monitor/snapshot — 获取当前活跃会话的上下文快照
 */

import { Router } from 'express';
import { getSnapshot } from './watcher';

const router = Router();

router.get('/snapshot', async (_req, res) => {
  try {
    const snapshot = await getSnapshot();
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: '获取监控快照失败' });
  }
});

export default router;
