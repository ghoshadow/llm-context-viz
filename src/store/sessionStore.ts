import { create } from 'zustand';
import { get, post, del } from '../api/client';
import type {
  SessionListItem,
  SessionDetail,
  TurnSummary,
  TurnDetail,
} from '../types/session';
import type { OntologyData } from '../types/ontology';

export interface SessionStore {
  sessions: SessionListItem[];
  sessionsLoading: boolean;
  sessionsError: string | null;

  currentSessionId: string | null;
  currentSession: SessionDetail | null;
  currentSessionLoading: boolean;

  turns: TurnSummary[];
  turnsLoading: boolean;

  currentTurnIndex: number | null;
  currentTurn: TurnDetail | null;
  currentTurnLoading: boolean;

  uploadOpen: boolean;
  scannerOpen: boolean;
  uploading: boolean;
  uploadProgress: string | null;
  uploadError: string | null;

  // Scan result cache
  scanFiles: { path: string; name: string; size: number; modified: string; hash: string; imported: boolean; title?: string; model?: string; requests?: number; peakTokens?: number; turnCount?: number }[];
  scanStatus: string;
  setScanFiles: (files: { path: string; name: string; size: number; modified: string; hash: string; imported: boolean; title?: string; model?: string; requests?: number; peakTokens?: number; turnCount?: number }[], status: string) => void;

  fetchSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  fetchTurns: (sessionId: string) => Promise<void>;
  selectTurn: (turnIndex: number) => Promise<void>;
  openUpload: () => void;
  closeUpload: () => void;
  openScanner: () => void;
  closeScanner: () => void;
  uploadFile: (file: File) => Promise<string | null>;
  deleteSession: (id: string) => Promise<void>;
  fetchOntology: () => Promise<void>;

  // Ontology state
  ontologyData: OntologyData | null;
  ontologyLoading: boolean;
  ontologyError: string | null;
}

export const useSessionStore = create<SessionStore>((set, getState) => ({
  sessions: [],
  sessionsLoading: false,
  sessionsError: null,

  currentSessionId: null,
  currentSession: null,
  currentSessionLoading: false,

  turns: [],
  turnsLoading: false,

  currentTurnIndex: null,
  currentTurn: null,
  currentTurnLoading: false,

  uploadOpen: false,
  scannerOpen: false,
  uploading: false,
  uploadProgress: null,
  uploadError: null,

  ontologyData: null,
  ontologyLoading: false,
  ontologyError: null,

  fetchSessions: async () => {
    set({ sessionsLoading: true, sessionsError: null });
    try {
      const sessions = await get<SessionListItem[]>('/sessions');
      set({ sessions, sessionsLoading: false });
    } catch (err) {
      set({
        sessionsLoading: false,
        sessionsError: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  },

  selectSession: async (id: string) => {
    set({ currentSessionId: id, currentSessionLoading: true });
    try {
      const currentSession = await get<SessionDetail>(`/sessions/${id}`);
      set({ currentSession, currentSessionLoading: false });
      await getState().fetchTurns(id);
      await getState().fetchOntology();
    } catch {
      set({ currentSessionLoading: false });
    }
  },

  fetchTurns: async (sessionId: string) => {
    set({ turnsLoading: true });
    try {
      const turns = await get<TurnSummary[]>(`/sessions/${sessionId}/turns`);
      set({ turns, turnsLoading: false });
    } catch {
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
      set({ currentTurn, currentTurnLoading: false });
    } catch {
      set({ currentTurnLoading: false });
    }
  },

  openUpload: () => set({ uploadOpen: true }),
  closeUpload: () => set({ uploadOpen: false }),
  openScanner: () => set({ scannerOpen: true }),
  closeScanner: () => set({ scannerOpen: false }),

  scanFiles: [],
  scanStatus: '',
  setScanFiles: (files, status) => set({ scanFiles: files, scanStatus: status }),

  uploadFile: async (file: File) => {
    set({ uploading: true, uploadProgress: null, uploadError: null });
    try {
      const formData = new FormData();
      formData.append('file', file);

      const result = await post<{ id: string }>('/sessions/upload', formData);
      set({ uploading: false, uploadProgress: 'Upload complete', uploadOpen: false });

      await getState().fetchSessions();
      return result.id;
    } catch (err) {
      set({
        uploading: false,
        uploadError: err instanceof Error ? err.message : 'Upload failed',
      });
      return null;
    }
  },

  fetchOntology: async () => {
    const { currentSessionId } = getState();
    if (!currentSessionId) return;
    set({ ontologyLoading: true, ontologyError: null });
    try {
      const result = await get<{ sessionId: string; maxTurn: number; data: OntologyData }>(
        '/sessions/' + currentSessionId + '/ontology',
      );
      set({ ontologyData: result.data, ontologyLoading: false });
    } catch (err) {
      set({
        ontologyLoading: false,
        ontologyError: err instanceof Error ? err.message : 'Failed to load ontology',
      });
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
          currentTurnIndex: wasCurrent ? null : state.currentTurnIndex,
          currentTurn: wasCurrent ? null : state.currentTurn,
        };
      });
    } catch {
      // deletion failure is silent in store; caller can handle
    }
  },
}));
