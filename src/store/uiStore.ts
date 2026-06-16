import { create } from 'zustand';

type Page = 'home' | 'assembly' | 'inspector';

interface UIStore {
  // Page navigation
  page: Page;
  setPage: (page: Page) => void;

  // Hover state (shared across treemap, bar segments, legend rows)
  hoveredCategory: string | null;
  setHoveredCategory: (key: string | null) => void;

  // Growth chart hover tooltip
  chartHover: { req: number; assembled: number; input: number; output: number; total: number } | null;
  setChartHover: (data: { req: number; assembled: number; input: number; output: number; total: number } | null) => void;

  // Turn Inspector: selected step index (for step detail panel)
  selectedStepIndex: number | null;
  setSelectedStepIndex: (index: number | null) => void;
  toggleStep: (index: number) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  page: 'home',
  setPage: (page) => set({ page }),

  hoveredCategory: null,
  setHoveredCategory: (key) => set({ hoveredCategory: key }),

  chartHover: null,
  setChartHover: (data) => set({ chartHover: data }),

  selectedStepIndex: null,
  setSelectedStepIndex: (index) => set({ selectedStepIndex: index }),
  toggleStep: (index) =>
    set((state) => ({
      selectedStepIndex: state.selectedStepIndex === index ? null : index,
    })),
}));
