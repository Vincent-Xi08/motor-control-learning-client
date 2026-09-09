import { m } from 'framer-motion';
import { lazy, Suspense, useMemo, useRef } from 'react';
import { ModuleRenderer } from '../../modules/ModuleRenderer';
import { useI18n } from '../../i18n/useI18n';
import { localizeModuleMeta, moduleMetas } from '../../simulation/engine/presets';
import type { ModuleMeta } from '../../simulation/engine/types';
import { useSimulationStore } from '../../store/simulationStore';
import { useUIStore } from '../../store/uiStore';
import { GuidedExperimentBar } from './GuidedExperimentBar';
import { ModuleSectionNav } from './ModuleSectionNav';
import { moduleSwap } from '../../utils/motion';

// 课程主线 / 学习洞察都是非首屏视图（点图标栏才进入），
// 懒加载把各自的内容数据（curriculum 30k+ / insights 相关）移出主包
const CurriculumPanel = lazy(() =>
  import('../curriculum/CurriculumPanel').then((m) => ({ default: m.CurriculumPanel })),
);
const InsightsView = lazy(() =>
  import('../insights/InsightsView').then((m) => ({ default: m.InsightsView })),
);

const ASSEMBLY_MODULE_META: ModuleMeta = {
  id: 'assembly-workshop',
  // 占位文案；渲染时由 shell.assembly* 翻译覆盖（见 fallbackMeta）
  title: '',
  shortTitle: '',
  subtitle: '',
  stage: '17',
  accent: '#43f7b5',
};

export function SimulationPanel() {
  const { t, locale } = useI18n();
  const activeModule = useSimulationStore((state) => state.activeModule);
  const mode = useSimulationStore((state) => state.mode);
  const simPanelView = useUIStore((state) => state.simPanelView);
  const setSimPanelView = useUIStore((state) => state.setSimPanelView);
  const moduleScrollRef = useRef<HTMLElement>(null);
  // assembly-workshop 不在 moduleMetas 里，回退 meta 的文案走 i18n
  const fallbackMeta = useMemo<ModuleMeta>(
    () => ({
      ...ASSEMBLY_MODULE_META,
      title: t('shell.assemblyTitle'),
      shortTitle: t('shell.assemblyShortTitle'),
      subtitle: t('shell.assemblySubtitle'),
    }),
    [t],
  );
  const meta = moduleMetas.find((item) => item.id === activeModule) ?? fallbackMeta;
  // currentView: 'module' | 'curriculum' | 'insights'
  // 三种顶层视图互斥；仅顶层 if 决定渲染哪一支，不破坏现有 16+1 模块渲染。
  if (simPanelView === 'curriculum') {
    return (
      <section
        className="scrollbar-thin min-h-0 space-y-4 overflow-auto rounded-2xl border border-line-subtle bg-bg-surface p-4"
        aria-label={t('shell.simViewCurriculumAria')}
      >
        <Suspense fallback={<ViewSkeleton label={t('shell.curriculumEntry')} />}>
          <CurriculumPanel onLeaveCurriculum={() => setSimPanelView('module')} />
        </Suspense>
      </section>
    );
  }
  if (simPanelView === 'insights') {
    return (
      <section
        className="scrollbar-thin min-h-0 space-y-4 overflow-auto rounded-2xl border border-line-subtle bg-bg-surface p-4"
        aria-label={t('shell.simViewInsightsAria')}
      >
        <Suspense fallback={<ViewSkeleton label={t('insights.title')} />}>
          <InsightsView />
        </Suspense>
      </section>
    );
  }
  return (
    <section ref={moduleScrollRef} className="scrollbar-thin min-h-0 space-y-4 overflow-auto rounded-2xl border border-line-subtle bg-bg-surface p-4">
      {/* 粘性模块头：标题行 + 卡片锚点芯片条（滚动时常驻，scroll-spy 高亮当前卡片；
          背景用实色 bg-bg-surface 铺满（负 margin 抵消父级 padding），不使用 blur） */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-2 border-b border-line-subtle bg-bg-surface px-4 pb-2 pt-4">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-caption text-ink-muted">{meta.stage}</span>
          <h1 className="font-display text-display text-ink-primary">{localizeModuleMeta(meta, locale).title}</h1>
          <p className="text-body text-ink-secondary">{localizeModuleMeta(meta, locale).subtitle}</p>
        </header>
        <div className="mt-2">
          <ModuleSectionNav scrollContainerRef={moduleScrollRef} moduleId={activeModule} />
        </div>
      </div>
      {mode === 'teach' && <GuidedExperimentBar moduleId={activeModule} />}
      {/*
        历史教训：曾经把 ModuleRenderer 包在 <AnimatePresence mode="wait">
        ＋ <m.div key={activeModule}> 内做模块切换淡入淡出。但 ModuleRenderer
        内部用 React.lazy + Suspense 异步加载模块 chunk，在 framer-motion v12 +
        React 19 的并发模式下出现：连续切换 14+ 模块后，新模块的 lazy promise
        虽然已经 resolve（chunk 200 OK），但 AnimatePresence 仍然把旧 m.div
        卡在 exit 队列里，新 m.div 即使挂载也只渲染 Suspense fallback——
        因为 mode="wait" 的 exit-then-enter 锁与 Suspense throw 出来的 promise
        生命周期相互争用，旧 child 的 onExitComplete 永远不触发。
        修复：把入场动画从外层挪到 m.div key 上（不用 AnimatePresence），
        Suspense 的状态机就独立运行，lazy chunk 一旦 resolve 立即重渲染。
        详见 docs/E2E_APF_FLAKE_RCA.md。
      */}
      <m.div
        key={activeModule}
        variants={moduleSwap}
        initial="hidden"
        animate="visible"
      >
        <ModuleRenderer moduleId={activeModule} />
      </m.div>
    </section>
  );
}

/** 视图懒加载骨架：与面板容器同款边框 + 居中脉冲文案 */
function ViewSkeleton({ label }: { label: string }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-line-subtle bg-bg-base">
      <p className="animate-pulse text-caption text-ink-muted">{label}</p>
    </div>
  );
}
