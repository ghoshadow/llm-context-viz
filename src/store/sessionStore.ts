import { create } from 'zustand';
import { get, post, del } from '../api/client';
import { consumeSSE } from '../utils/sse.js';
import { API_BASE } from '../api/client';
import type {
  SessionListItem,
  SessionDetail,
  TurnSummary,
  TurnListPage,
  TurnDetail,
} from '../types/session';
import type { OntologyData } from '../types/ontology';

type ScanFileSource = 'claude' | 'codex' | 'opencode' | 'pi';
type ScanFile = { path: string; name: string; size: number; modified: string; source?: ScanFileSource; hash: string; imported: boolean; title?: string; model?: string; requests?: number; peakTokens?: number; turnCount?: number; cwd?: string };

export interface SessionStore {
  sessions: SessionListItem[];
  sessionsLoading: boolean;

  currentSessionId: string | null;
  currentSession: SessionDetail | null;

  turns: TurnSummary[];
  turnsLoading: boolean;
  turnsTotal: number;
  turnsHasMore: boolean;
  turnsPageSize: number;

  currentTurnIndex: number | null;
  currentTurn: TurnDetail | null;
  currentTurnLoading: boolean;

  scannerOpen: boolean;

  // Scan result cache
  scanFiles: ScanFile[];
  scanStatus: string;
  setScanFiles: (files: ScanFile[], status: string) => void;

  fetchSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  fetchTurns: (sessionId: string) => Promise<void>;
  fetchMoreTurns: () => Promise<void>;
  selectTurn: (turnIndex: number) => Promise<void>;
  openScanner: () => void;
  closeScanner: () => void;
  deleteSession: (id: string) => Promise<void>;
  fetchOntology: () => Promise<void>;
  extractOntology: (options?: { shardSize?: number; maxShardChars?: number; force?: boolean; incremental?: boolean; retryFailedOnly?: boolean; extractionDepth?: 'refined' | 'deep' }) => Promise<boolean>;
  fetchExtractStatus: () => Promise<void>;

  // Ontology state
  ontologyData: OntologyData | null;
  ontologyMaxTurn: number;
  ontologyLoading: boolean;
  ontologyError: string | null;
  ontologyFetched: boolean;
  extractPhase: 'idle' | 'extracting' | 'merging' | 'building';
  extractProgress: { shardsTotal: number; shardsCompleted: number; shardDetails: Array<{ index: number; status: 'pending' | 'running' | 'done' | 'error'; candidates?: number; relations?: number; error?: string }> };
  extractDepth: 'refined' | 'deep';
  extractShardSize: number;
  extractMaxShardChars: number;
  extractRootDir: string | null;
  extractError: string | null;
}

export const useSessionStore = create<SessionStore>((set, getState) => ({
  sessions: [],
  sessionsLoading: false,

  currentSessionId: null,
  currentSession: null,

  turns: [],
  turnsLoading: false,
  turnsTotal: 0,
  turnsHasMore: false,
  turnsPageSize: 200,

  currentTurnIndex: null,
  currentTurn: null,
  currentTurnLoading: false,

  scannerOpen: false,

  ontologyData: null,
  ontologyMaxTurn: 0,
  ontologyLoading: false,
  ontologyError: null,
  ontologyFetched: false,

  extractPhase: 'idle' as const,
  extractProgress: { shardsTotal: 0, shardsCompleted: 0, shardDetails: [] },
  extractDepth: 'refined',
  extractShardSize: 30,
  extractMaxShardChars: 45000,
  extractRootDir: null,
  extractError: null,

  fetchSessions: async () => {
    set({ sessionsLoading: true });
    try {
      const sessions = await get<SessionListItem[]>('/sessions');
      set({ sessions, sessionsLoading: false });
    } catch (err) {
      set({ sessionsLoading: false });
    }
  },

  selectSession: async (id: string) => {
    set({
      currentSessionId: id,
      currentSession: null,
      turns: [],
      turnsLoading: false,
      turnsTotal: 0,
      turnsHasMore: false,
      currentTurnIndex: null,
      currentTurn: null,
      currentTurnLoading: false,
      ontologyData: null,
      ontologyLoading: false,
      ontologyError: null,
      ontologyFetched: false,
      extractPhase: 'idle',
      extractProgress: { shardsTotal: 0, shardsCompleted: 0, shardDetails: [] },
      extractRootDir: null,
      extractError: null,
    });
    try {
      const currentSession = await get<SessionDetail>(`/sessions/${id}`);
      if (getState().currentSessionId !== id) return;
      set({ currentSession });
      await getState().fetchTurns(id);
      if (getState().currentSessionId !== id) return;
      await getState().fetchOntology();
    } catch {
      // silently ignore — the UI handles errors through currentSession null
    }
  },

  fetchTurns: async (sessionId: string) => {
    if (getState().currentSessionId !== sessionId) return;
    set({ turnsLoading: true });
    try {
      const { turnsPageSize } = getState();
      const page = await get<TurnListPage>(`/sessions/${sessionId}/turns?limit=${turnsPageSize}&offset=0`);
      if (getState().currentSessionId !== sessionId) return;
      set({
        turns: page.items,
        turnsTotal: page.total,
        turnsHasMore: page.hasMore,
        turnsLoading: false,
      });
    } catch {
      if (getState().currentSessionId !== sessionId) return;
      set({ turnsLoading: false });
    }
  },

  fetchMoreTurns: async () => {
    const { currentSessionId, turns, turnsLoading, turnsHasMore, turnsPageSize } = getState();
    if (!currentSessionId || turnsLoading || !turnsHasMore) return;

    set({ turnsLoading: true });
    try {
      const page = await get<TurnListPage>(
        `/sessions/${currentSessionId}/turns?limit=${turnsPageSize}&offset=${turns.length}`,
      );
      if (getState().currentSessionId !== currentSessionId) return;
      if (getState().turns.length !== turns.length) {
        set({ turnsLoading: false });
        return;
      }
      set({
        turns: [...turns, ...page.items],
        turnsTotal: page.total,
        turnsHasMore: page.hasMore,
        turnsLoading: false,
      });
    } catch {
      if (getState().currentSessionId !== currentSessionId) return;
      set({ turnsLoading: false });
    }
  },

  selectTurn: async (turnIndex: number) => {
    const { currentSessionId } = getState();
    if (!currentSessionId) return;

    set({ currentTurnIndex: turnIndex, currentTurnLoading: true });
    try {
      const currentTurn = await get<TurnDetail>(
        `/sessions/${currentSessionId}/turns/${turnIndex}`,
      );
      if (getState().currentSessionId !== currentSessionId || getState().currentTurnIndex !== turnIndex) return;
      set({ currentTurn, currentTurnLoading: false });
    } catch {
      if (getState().currentSessionId !== currentSessionId || getState().currentTurnIndex !== turnIndex) return;
      set({ currentTurnLoading: false });
    }
  },

  openScanner: () => set({ scannerOpen: true }),
  closeScanner: () => set({ scannerOpen: false }),

  scanFiles: [],
  scanStatus: '',
  setScanFiles: (files, status) => set({ scanFiles: files, scanStatus: status }),

  fetchOntology: async () => {
    const { currentSessionId } = getState();
    if (!currentSessionId) return;
    set({ ontologyLoading: true, ontologyError: null });
    try {
      const result = await get<{ data: OntologyData | null; maxTurn?: number }>(
        '/sessions/' + currentSessionId + '/ontology',
      );
      if (getState().currentSessionId !== currentSessionId) return;
      if (result.data) {
        set({ ontologyData: result.data, ontologyMaxTurn: result.maxTurn ?? 0, ontologyLoading: false, ontologyFetched: true });
      } else {
        set({ ontologyData: null, ontologyMaxTurn: 0, ontologyLoading: false, ontologyError: null, ontologyFetched: true });
      }
    } catch {
      if (getState().currentSessionId !== currentSessionId) return;
      set({ ontologyData: null, ontologyMaxTurn: 0, ontologyLoading: false, ontologyError: null, ontologyFetched: true });
    }
  },

  deleteSession: async (id: string) => {
    try {
      await del(`/sessions/${id}`);
      set((state) => {
        const nextSessions = state.sessions.filter((s) => s.id !== id);
        const wasCurrent = state.currentSessionId === id;
        return {
          sessions: nextSessions,
          currentSessionId: wasCurrent ? null : state.currentSessionId,
          currentSession: wasCurrent ? null : state.currentSession,
          turns: wasCurrent ? [] : state.turns,
          turnsTotal: wasCurrent ? 0 : state.turnsTotal,
          turnsHasMore: wasCurrent ? false : state.turnsHasMore,
          currentTurnIndex: wasCurrent ? null : state.currentTurnIndex,
          currentTurn: wasCurrent ? null : state.currentTurn,
        };
      });
    } catch {
      // deletion failure is silent in store; caller can handle
    }
  },

  extractOntology: async (options) => {
    const { currentSessionId } = getState();
    if (!currentSessionId) return false;
    const isCurrentSession = () => getState().currentSessionId === currentSessionId;

    const requestedDepth = options?.extractionDepth ?? 'refined';
    set({
      extractPhase: 'extracting',
      extractError: null,
      extractDepth: requestedDepth,
      extractShardSize: options?.shardSize ?? 30,
      extractMaxShardChars: options?.maxShardChars ?? 45000,
    });
    let succeeded = false;

    try {
      await consumeSSE(
        `${API_BASE}/sessions/${currentSessionId}/ontology/extract`,
        {
          shardSize: options?.shardSize,
          maxShardChars: options?.maxShardChars,
          force: options?.force ?? false,
          incremental: options?.incremental ?? false,
          retryFailedOnly: options?.retryFailedOnly ?? false,
          extractionDepth: options?.extractionDepth ?? 'refined',
        },
        {
          onExtracted: (data) => {
            if (!isCurrentSession()) return;
            const shardDetails = data.shards.map((s) => ({
              index: s.index,
              status: 'pending' as const,
            }));
            set({
              extractRootDir: data.rootDir,
              extractDepth: data.extractionDepth ?? requestedDepth,
              extractShardSize: data.shardSize ?? options?.shardSize ?? 30,
              extractMaxShardChars: data.maxShardChars ?? options?.maxShardChars ?? 45000,
              extractProgress: {
                shardsTotal: data.activeShards ?? data.shardCount,
                shardsCompleted: 0,
                shardDetails,
              },
            });
          },
          onStart: (data) => {
            if (!isCurrentSession()) return;
            set((state) => ({
              extractProgress: {
                ...state.extractProgress,
                shardsTotal: data.shards,
                shardsCompleted: 0,
                shardDetails: state.extractProgress.shardDetails.length > 0
                  ? state.extractProgress.shardDetails
                  : Array.from({ length: data.shards }, (_, i) => ({ index: i, status: 'pending' as const })),
              },
            }));
          },
          onShardStart: (data) => {
            if (!isCurrentSession()) return;
            set((state) => {
              const details = state.extractProgress.shardDetails.map((s) =>
                s.index === data.shardIndex ? { ...s, status: 'running' as const } : s,
              );
              return { extractProgress: { ...state.extractProgress, shardDetails: details } };
            });
          },
          onShardDone: (data) => {
            if (!isCurrentSession()) return;
            set((state) => {
              const wasDone = state.extractProgress.shardDetails.some((s) => s.index === data.shardIndex && s.status === 'done');
              const details = state.extractProgress.shardDetails.map((s) =>
                s.index === data.shardIndex
                  ? {
                      ...s,
                      status: 'done' as const,
                      error: undefined,
                      candidates: Array.isArray(data.candidates) ? data.candidates.length : undefined,
                      relations: Array.isArray(data.relations) ? data.relations.length : undefined,
                    }
                  : s,
              );
              return {
                extractProgress: {
                  ...state.extractProgress,
                  shardsCompleted: wasDone
                    ? state.extractProgress.shardsCompleted
                    : state.extractProgress.shardsCompleted + 1,
                  shardDetails: details,
                },
              };
            });
          },
          onShardRetry: (data) => {
            if (!isCurrentSession()) return;
            set((state) => {
              const details = state.extractProgress.shardDetails.map((s) =>
                s.index === data.shardIndex
                  ? { ...s, status: 'running' as const, error: `第 ${data.attempt} 次尝试` }
                  : s,
              );
              return { extractProgress: { ...state.extractProgress, shardDetails: details } };
            });
          },
          onShardError: (data) => {
            if (!isCurrentSession()) return;
            set((state) => {
              const details = state.extractProgress.shardDetails.map((s) =>
                s.index === data.shardIndex
                  ? { ...s, status: 'error' as const, error: data.error }
                  : s,
              );
              return {
                extractProgress: {
                  ...state.extractProgress,
                  shardDetails: details,
                },
              };
            });
          },
          onMerge: () => {
            if (!isCurrentSession()) return;
            set({ extractPhase: 'merging' });
          },
          onBuild: () => {
            if (!isCurrentSession()) return;
            set({ extractPhase: 'building' });
          },
          onComplete: () => {
            if (!isCurrentSession()) return;
            succeeded = true;
            getState().fetchOntology();
            const failed = getState().extractProgress.shardDetails.filter((s) => s.status === 'error').length;
            set({
              extractPhase: 'idle',
              extractError: failed > 0
                ? `已保存部分结果，仍有 ${failed} 个分片未完成`
                : null,
            });
          },
          onError: (data) => {
            if (!isCurrentSession()) return;
            set({
              extractError: data.message,
              extractPhase: 'idle',
            });
          },
        },
      );

      return succeeded;
    } catch (err) {
      if (!isCurrentSession()) return false;
      set({
        extractPhase: 'idle',
        extractError: err instanceof Error ? err.message : 'Extraction failed',
      });
      return false;
    }
  },

  fetchExtractStatus: async () => {
    const { currentSessionId } = getState();
    if (!currentSessionId) return;

    try {
      const status = await get<{
        active: boolean;
        phase: 'idle' | 'extracting' | 'merging' | 'building' | 'complete' | 'error';
        rootDir?: string | null;
        shardCount?: number;
        shardsCompleted?: number;
        shardDetails?: Array<{ index: number; status: 'pending' | 'running' | 'done' | 'error'; candidates?: number; relations?: number; error?: string }>;
        error?: string | null;
        extractionDepth?: 'refined' | 'deep';
        shardSize?: number | null;
        maxShardChars?: number | null;
      }>(`/sessions/${currentSessionId}/ontology/extract/status`);

      if (getState().currentSessionId !== currentSessionId) return;
      const activePhase = status.phase === 'complete' || status.phase === 'error' ? 'idle' : status.phase;
      set({
        extractPhase: activePhase,
        extractRootDir: status.rootDir || null,
        extractError: status.phase === 'error' ? status.error || 'Extraction failed' : null,
        extractDepth: status.extractionDepth ?? getState().extractDepth,
        extractShardSize: status.shardSize ?? getState().extractShardSize,
        extractMaxShardChars: status.maxShardChars ?? getState().extractMaxShardChars,
        extractProgress: {
          shardsTotal: status.shardCount || 0,
          shardsCompleted: status.shardsCompleted || 0,
          shardDetails: status.shardDetails || [],
        },
      });

      if (status.phase === 'complete' && getState().currentSessionId === currentSessionId) {
        await getState().fetchOntology();
      }
    } catch {
      // 状态恢复失败不影响正常页面使用
    }
  },
}));
