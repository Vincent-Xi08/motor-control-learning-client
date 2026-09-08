import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { moduleMetas } from '../../simulation/engine/presets';
import type { ModuleId } from '../../simulation/engine/types';
import { getCachedWalkthrough, hasWalkthrough, loadModuleWalkthrough } from '../../content/walkthroughs';
import { useAssistantStore } from '../../store/assistantStore';
import { useProgressStore } from '../../store/progressStore';
import { useSimulationStore } from '../../store/simulationStore';
import { useThemeStore } from '../../store/themeStore';
import { useUIStore } from '../../store/uiStore';
import { useKeyboardShortcuts, type Shortcut } from '../../utils/useKeyboardShortcuts';
import { KeyHelpOverlay } from './KeyHelpOverlay';

/**
 * 应用级全局快捷键注册组件：渲染 null，仅副作用。
 *
 * 模块切换 (ArrowLeft / ArrowRight) 采用循环 wrap 策略——
 * 走到首/尾再按方向键会绕回另一端，方便快速浏览全部 16 个 stage。
 *
 * 数字键 1-9 对应 stage 01-09，0 对应 stage 10。stage 11-16 因为没有
 * 单字符直觉映射，留给方向键导航 + 侧栏点选。
 */
export function GlobalKeybindings() {
  const { t } = useI18n();
  const setActiveModule = useSimulationStore((s) => s.setActiveModule);
  const setRunning = useSimulationStore((s) => s.setRunning);
  const step = useSimulationStore((s) => s.step);
  const resetTime = useSimulationStore((s) => s.resetTime);
  const toggleFullScreen = useSimulationStore((s) => s.toggleFullScreen);
  const setMode = useSimulationStore((s) => s.setMode);
  const cycleTheme = useThemeStore((s) => s.cycleTheme);

  const [helpOpen, setHelpOpen] = useState(false);

  const shortcuts = useMemo<Shortcut[]>(() => {
    /** 上一个 / 下一个：基于当前 store 实时取 activeModule，并在 moduleMetas 中循环 wrap。 */
    const gotoNeighbor = (delta: -1 | 1) => {
      const { activeModule } = useSimulationStore.getState();
      const idx = moduleMetas.findIndex((m) => m.id === activeModule);
      if (idx < 0) return;
      const len = moduleMetas.length;
      const nextIdx = (idx + delta + len) % len;
      setActiveModule(moduleMetas[nextIdx].id);
    };

    /** 数字键跳到 stage：digit 1-9 → "01"-"09"，0 → "10"。 */
    const gotoStage = (digit: number) => {
      const stage = digit === 0 ? '10' : `0${digit}`;
      const target = moduleMetas.find((m) => m.stage === stage);
      if (target) setActiveModule(target.id as ModuleId);
    };

    /** walkthrough 步骤前/后：基于当前 activeModule 的 walkthrough（如有）。
     * 若 walkthrough 还没加载完成，触发一次 load 但本次不动步骤。 */
    const stepWalkthrough = (delta: -1 | 1) => {
      const { activeModule } = useSimulationStore.getState();
      if (!hasWalkthrough(activeModule)) return;
      const wt = getCachedWalkthrough(activeModule);
      if (!wt) {
        void loadModuleWalkthrough(activeModule);
        return;
      }
      const cur = useProgressStore.getState().perModule[activeModule]?.walkthroughStep ?? 0;
      const next = Math.max(0, Math.min(wt.steps.length - 1, cur + delta));
      if (next === cur) return;
      useProgressStore.getState().setWalkthroughStep(activeModule, next, next === wt.steps.length - 1);
      const step = wt.steps[next];
      if (step?.presetId) useSimulationStore.getState().applyExperimentPreset(step.presetId);
    };

    const list: Shortcut[] = [
      // —— 导航 ——
      {
        key: 'k',
        category: '导航',
        description: t('shell.railPaletteAria'),
        meta: ['ctrl'],
        handler: (e) => {
          e.preventDefault();
          useUIStore.getState().setPaletteOpen(!useUIStore.getState().paletteOpen);
        },
      },
      // —— 运行控制 ——
      // 注意：category 是中文字面量联合类型，由 KeyHelpOverlay 的 CATEGORY_I18N
      // 映射到 shell.keyHelpCat* 翻译；description 直接进 KeyHelpOverlay 渲染，用 t()。
      {
        key: 'Space',
        category: '运行控制',
        description: t('shell.keyRunPause'),
        handler: (e) => {
          // Space 默认会滚动页面，得拦掉
          e.preventDefault();
          const running = useSimulationStore.getState().running;
          setRunning(!running);
        },
      },
      {
        key: 'r',
        category: '运行控制',
        description: t('shell.keyResetSimTime'),
        handler: () => resetTime(),
      },
      {
        key: 's',
        category: '运行控制',
        description: t('shell.keyStep5ms'),
        handler: () => step(0.005),
      },
      // —— 布局 ——
      {
        key: 'f',
        category: '布局',
        description: t('shell.keyToggleFullscreen'),
        handler: () => toggleFullScreen(),
      },
      {
        key: 'm',
        category: '布局',
        description: t('shell.keyCycleTheme'),
        handler: () => cycleTheme(),
      },
      // —— 模式 ——
      {
        key: 't',
        category: '模式',
        description: t('shell.keyToggleMode'),
        handler: () => {
          const cur = useSimulationStore.getState().mode;
          setMode(cur === 'teach' ? 'lab' : 'teach');
        },
      },
      // —— 导航 ——
      {
        key: 'ArrowLeft',
        category: '导航',
        description: t('shell.keyPrevModule'),
        handler: () => gotoNeighbor(-1),
      },
      {
        key: 'ArrowRight',
        category: '导航',
        description: t('shell.keyNextModule'),
        handler: () => gotoNeighbor(1),
      },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map<Shortcut>((d) => ({
        key: String(d),
        category: '导航',
        description: t('shell.keyGotoStage').replace('{n}', d === 0 ? '10' : `0${d}`),
        handler: () => gotoStage(d),
      })),
      // —— 教学引导（walkthrough）—— vim 风格快进/后退
      {
        key: 'j',
        category: '导航',
        description: t('shell.keyWalkthroughNext'),
        handler: () => stepWalkthrough(1),
      },
      {
        key: 'k',
        category: '导航',
        description: t('shell.keyWalkthroughPrev'),
        handler: () => stepWalkthrough(-1),
      },
      // —— 帮助 ——
      {
        key: '?',
        category: '帮助',
        description: t('shell.keyToggleKeyHelp'),
        handler: (e) => {
          e.preventDefault();
          setHelpOpen((v) => !v);
        },
      },
      {
        key: 'a',
        category: '帮助',
        description: t('shell.keyToggleAssistant'),
        handler: () => useAssistantStore.getState().toggleOpen(),
      },
      // —— 报告 ——
      {
        key: 'p',
        category: '运行控制',
        description: t('shell.keyPrintModule'),
        meta: ['ctrl'],
        handler: (e) => {
          e.preventDefault();
          window.print();
        },
      },
    ];
    return list;
  }, [t, setActiveModule, setRunning, step, resetTime, toggleFullScreen, setMode, cycleTheme]);

  useKeyboardShortcuts(shortcuts);

  return <KeyHelpOverlay open={helpOpen} shortcuts={shortcuts} onClose={() => setHelpOpen(false)} />;
}
