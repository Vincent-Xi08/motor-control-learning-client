import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 编程实验室（Code Lab）进度 store。
 *
 * 取代散落的 localStorage 直读（`codelab.solved.<id>`）：
 *  - CodeLabCard 通关时 markSolved；
 *  - 洞察面板 CodeLabProgressPanel 订阅 solved 切片，实时响应；
 *  - persist 到 localStorage key `compressor-bench-codelab`，
 *    migrate 钩子会把旧版散 key 一次性并入（v0.2.2 及之前的存档）。
 */
interface CodelabState {
  /** challengeId → true（已通关） */
  solved: Record<string, true>;
  markSolved: (id: string) => void;
  reset: () => void;
}

/** 旧版散 key（codelab.solved.<id> = true）一次性并入新 store 后清除。 */
function importLegacyKeys(
  set: (fn: (state: CodelabState) => Partial<CodelabState>) => void,
): void {
  if (typeof localStorage === 'undefined') return;
  const legacy: Record<string, true> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith('codelab.solved.')) continue;
    try {
      if (JSON.parse(localStorage.getItem(key) ?? '') === true) {
        legacy[key.slice('codelab.solved.'.length)] = true;
      }
    } catch { /* 损坏条目跳过 */ }
  }
  if (Object.keys(legacy).length > 0) {
    set((state) => ({ solved: { ...legacy, ...state.solved } }));
    for (const id of Object.keys(legacy)) localStorage.removeItem(`codelab.solved.${id}`);
  }
}

export const useCodelabStore = create<CodelabState>()(
  persist(
    (set) => ({
      solved: {},
      markSolved: (id) => set((state) => ({ solved: { ...state.solved, [id]: true } })),
      reset: () => set({ solved: {} }),
    }),
    {
      name: 'compressor-bench-codelab',
      version: 1,
      partialize: (state) => ({ solved: state.solved }) as Partial<CodelabState>,
      onRehydrateStorage: () => () => {
        importLegacyKeys(useCodelabStore.setState);
      },
    },
  ),
);

// 模块加载即跑一次旧档迁移（persist rehydrate 是异步的，这里同步兜底）
if (typeof window !== 'undefined') importLegacyKeys(useCodelabStore.setState);
