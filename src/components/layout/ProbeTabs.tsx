import { useEffect, useState, type ReactNode } from 'react';
import { m, AnimatePresence } from 'framer-motion';

export interface ProbeTab {
  id: string;
  label: string;
  hint?: string;
  badge?: string | number;
  content: ReactNode;
}

interface Props {
  tabs: ProbeTab[];
  defaultId?: string;
  /** 持久化 key — 给定后会把 active tab 写入 localStorage */
  storageKey?: string;
}

/**
 * 分组化的 probe 列：把多张卡片按类别分到 2-3 个 tab，
 * 避免 7+ 张卡片同时堆叠导致视觉过载。
 *
 * 设计：
 * - 顶部一排 tab 按钮（自适应宽度）
 * - 内容区淡入淡出切换（framer-motion，不重新挂载，仅切显隐）
 * - 当前 tab 用 mint 色加细底线
 */
export function ProbeTabs({ tabs, defaultId, storageKey }: Props) {
  const [activeId, setActiveId] = useState(() => {
    if (storageKey && typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && tabs.some((t) => t.id === saved)) return saved;
    }
    return defaultId ?? tabs[0]?.id;
  });
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, activeId);
    }
  }, [storageKey, activeId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 rounded-xl border border-line-subtle bg-bg-surface p-1">
        {tabs.map((tab) => {
          const isActive = tab.id === active.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              title={tab.hint}
              className={`relative flex-1 rounded-lg px-3 py-1.5 text-caption font-medium transition-colors ${
                isActive
                  ? 'bg-bg-base text-accent-measure shadow-sm'
                  : 'text-ink-muted hover:text-ink-secondary'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                {tab.label}
                {tab.badge != null && (
                  <span
                    className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${
                      isActive ? 'bg-accent-measure text-bg-base' : 'bg-line-subtle text-ink-muted'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </span>
              {isActive && (
                <m.span
                  layoutId="probe-tab-underline"
                  className="absolute -bottom-1 left-1/4 right-1/4 h-0.5 rounded-full bg-accent-measure"
                />
              )}
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        <m.div
          key={active.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="space-y-4"
        >
          {active.content}
        </m.div>
      </AnimatePresence>
    </div>
  );
}
