/**
 * useMonitor.ts — 轮询 /api/monitor/snapshot，更新 Tauri 托盘提示。
 *
 * 在 App 层调用一次即可，5 秒轮询。
 */

import { useEffect, useRef } from 'react';

import { get } from '../api/client';

interface MonitorSnapshot {
  active?: boolean;
  contextPct: number;
  alerts?: Array<{ message: string }>;
  turnCount: number;
  compressionReset?: boolean;
}

// ponytail: Tauri invoke 在浏览器模式下不可用，静默降级
let tauriInvoke: ((cmd: string, args: Record<string, unknown>) => Promise<void>) | null = null;
import('@tauri-apps/api/core').then(m => { tauriInvoke = m.invoke; }).catch(() => {});

async function updateTray(text: string) {
  if (tauriInvoke) {
    try { await tauriInvoke('update_tray_tooltip', { text }); } catch { /* ok */ }
  }
}

export function useMonitor() {
  const lastPct = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    async function poll() {
      try {
        const snap = await get<MonitorSnapshot>('/monitor/snapshot');

        if (snap.active) {
          const pct: number = snap.contextPct;
          const firstAlert = snap.alerts?.[0]?.message;
          const alertText: string = firstAlert ? ` — ${firstAlert}` : '';
          let trayText = `上下文 ${pct}% | ${snap.turnCount} 轮`;
          if (snap.compressionReset) trayText += ' | ⚡压缩';
          trayText += alertText;

          if (pct !== lastPct.current || snap.compressionReset) {
            lastPct.current = pct;
            await updateTray(trayText);
          }
        } else {
          if (lastPct.current !== -1) {
            lastPct.current = -1;
            await updateTray('LLM Context Viz — 等待会话…');
          }
        }
      } catch { /* 静默失败 */ }
    }

    poll();
    timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, []);
}
