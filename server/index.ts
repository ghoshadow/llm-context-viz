import 'dotenv/config';

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import sessionsRouter from './routes/sessions';
import scannerRouter from './routes/scanner';
import calibrateRouter from './routes/calibrate';
import obsidianRouter from './routes/obsidian';
import { initDb, migrate } from './db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4137;

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
