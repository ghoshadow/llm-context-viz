import 'dotenv/config';

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import sessionsRouter from './routes/sessions';
import scannerRouter from './routes/scanner';
import calibrateRouter from './routes/calibrate';
import obsidianRouter from './routes/obsidian';
import { initDb, migrate } from './db';
import { sanitizeForLog } from './utils/log-sanitizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4137;

// ============================================================================
// 进程级错误兜底处理 —— 防止未捕获异常导致进程崩溃
// ============================================================================

process.on('uncaughtException', (err: Error) => {
  if (process.env.NODE_ENV === 'production') {
    console.error('uncaughtException:', sanitizeForLog(err.message));
  } else {
    console.error('uncaughtException:', err.stack || err.message);
  }
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 1000).unref();
});

process.on('unhandledRejection', (reason: unknown) => {
  if (process.env.NODE_ENV === 'production') {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error('unhandledRejection:', sanitizeForLog(message));
  } else {
    if (reason instanceof Error) {
      console.error('unhandledRejection:', reason.stack || reason.message);
    } else {
      console.error('unhandledRejection:', reason);
    }
  }
});

const app = express();

// CORS: allow all origins (local tool)
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: '50mb' }));

// API routes
app.use('/api/sessions', sessionsRouter);
app.use('/api/scanner', scannerRouter);
app.use('/api/calibrate', calibrateRouter);
app.use('/api/obsidian', obsidianRouter);

const PROJECT_ROOT = path.join(__dirname, '..');

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', db: 'connected', projectRoot: PROJECT_ROOT });
});

// In production, serve the built frontend
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Initialize database then start server
initDb();
migrate();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
