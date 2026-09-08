import { Command, Gauge, LineChart, Sliders, Target } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { localizeModuleMeta, moduleMetas } from '../../simulation/engine/presets';
import type { ModuleId } from '../../simulation/engine/types';
import { iconForModule } from './moduleIcons';
import { useI18n } from '../../i18n/useI18n';
import { useSimulationStore } from '../../store/simulationStore';
import { useUIStore } from '../../store/uiStore';

/**
 * 命令面板（Ctrl+K 快速跳转）—— 双栏沉浸壳层的全局导航入口。
 *
 * 匹配范围：模块的中文名 / 英文名 / 短名 / stage / id（大小写不敏感子串），
 * 外加课程主线、学习洞察、参数坞三个动作项。↑↓ 循环、Enter 执行、Esc 关闭。
 * 纯前端内存过滤（Array.filter + includes），无任何持久层。
 */
interface PaletteItem {
  key: string;
  /** 展示主文案（当前 locale） */
  label: string;
  /** 次要文案（stage / 说明） */
  hint: string;
  icon: typeof Gauge;
  keywords: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen);
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen);
  const setActiveModule = useSimulationStore((s) => s.setActiveModule);
  const setSimPanelView = useUIStore((s) => s.setSimPanelView);
  const toggleParamsDock = useUIStore((s) => s.toggleParamsDock);
  const { t, locale } = useI18n();
  const [filterText, setFilterText] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 打开时重置输入并聚焦（Ctrl+K 的全局注册在 GlobalKeybindings，集中管理）
  useEffect(() => {
    if (open) {
      setFilterText('');
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const moduleItems: PaletteItem[] = moduleMetas.map((meta) => {
      const loc = localizeModuleMeta(meta, locale);
      return {
        key: `module:${meta.id}`,
        label: `${meta.stage} · ${loc.title}`,
        hint: loc.shortTitle,
        icon: iconForModule(meta.id),
        keywords: `${meta.title} ${meta.titleEn ?? ''} ${meta.shortTitle} ${meta.shortTitleEn ?? ''} ${meta.stage} ${meta.id}`.toLowerCase(),
        run: () => {
          setActiveModule(meta.id as ModuleId);
          setSimPanelView('module');
          setPaletteOpen(false);
        },
      };
    });
    const actionItems: PaletteItem[] = [
      {
        key: 'action:curriculum',
        label: t('shell.railCurriculum'),
        hint: 'Ctrl+K',
        icon: Target,
        keywords: `curriculum ${t('shell.curriculumEntry')} 课程`.toLowerCase(),
        run: () => { setSimPanelView('curriculum'); setPaletteOpen(false); },
      },
      {
        key: 'action:insights',
        label: t('shell.railInsights'),
        hint: 'insights',
        icon: LineChart,
        keywords: `insights ${t('shell.railInsights')} 洞察 错题`.toLowerCase(),
        run: () => { setSimPanelView('insights'); setPaletteOpen(false); },
      },
      {
        key: 'action:params',
        label: t('shell.paramsDockShow'),
        hint: 'P',
        icon: Sliders,
        keywords: `params ${t('shell.paramsDockTitle')} 参数`.toLowerCase(),
        run: () => { toggleParamsDock(); setPaletteOpen(false); },
      },
    ];
    return [...moduleItems, ...actionItems];
  }, [locale, t, setActiveModule, setSimPanelView, setPaletteOpen, toggleParamsDock]);

  const visibleItems = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => it.keywords.includes(needle) || it.label.toLowerCase().includes(needle));
  }, [items, filterText]);

  // 过滤结果变化时收敛选中项
  useEffect(() => { setActive(0); }, [filterText]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, visibleItems.length]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setPaletteOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((v) => (visibleItems.length ? (v + 1) % visibleItems.length : 0)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((v) => (visibleItems.length ? (v - 1 + visibleItems.length) % visibleItems.length : 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = visibleItems[active];
      if (item) item.run();
    }
  };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={t('shell.paletteTitle')}>
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/60" onClick={() => setPaletteOpen(false)} aria-hidden />
      {/* 面板：顶部 16% 居中 */}
      <div className="absolute inset-x-4 top-[16%] mx-auto max-w-[560px] overflow-hidden rounded-2xl border border-line-strong bg-bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line-subtle px-3">
          <Command className="h-4 w-4 shrink-0 text-accent-primary" aria-hidden />
          <input
            ref={inputRef}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('shell.palettePlaceholder')}
            aria-label={t('shell.paletteTitle')}
            className="h-12 w-full bg-transparent text-body text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-line-subtle bg-bg-base px-1.5 py-0.5 text-[10px] text-ink-muted sm:inline">Esc</kbd>
        </div>
        <ul ref={listRef} className="scrollbar-thin max-h-[46vh] overflow-auto p-1.5" role="listbox">
          {visibleItems.length === 0 && (
            <li className="px-3 py-6 text-center text-caption text-ink-muted">{t('shell.paletteEmpty')}</li>
          )}
          {visibleItems.map((item, i) => {
            const Icon = item.icon;
            const isActive = i === active;
            return (
              <li key={item.key} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  data-active={isActive}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => item.run()}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    isActive ? 'bg-accent-primary/10 text-accent-primary' : 'text-ink-secondary hover:bg-bg-raised'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-body">{item.label}</span>
                  <span className="shrink-0 text-caption text-ink-muted">{item.hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-line-subtle px-3 py-2 text-center text-[11px] text-ink-muted">
          {t('shell.paletteHint')}
        </div>
      </div>
    </div>
  );
}
