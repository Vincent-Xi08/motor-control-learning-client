import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import { GlobalKeybindings } from './components/layout/GlobalKeybindings';
import { FloatingChatButton } from './components/assistant/FloatingChatButton';
import { UpdateBanner } from './components/desktop/UpdateBanner';
import { ReceiveSnapshotModal } from './components/share/ReceiveSnapshotModal';
// 助手面板（含 RAG 索引 / LLM provider 链）非首屏：首次打开聊天时才加载
const AssistantPanel = lazy(() =>
  import('./components/assistant/AssistantPanel').then((m) => ({ default: m.AssistantPanel })),
);
import {
  isDesktopRuntime,
  subscribeMenu,
  subscribeOpenSnapshot,
  syncWindowStateOnce,
  type DesktopMenuEvent,
  type OpenSnapshotPayload,
} from './utils/desktopBridge';
import { decodeSnapshot, type AppStateInput, type DecodedSnapshot } from './utils/snapshotCodec';
import { getCurrentLocale, translate, useI18n } from './i18n/useI18n';
import { useAssistantStore } from './store/assistantStore';
import { useSimulationStore } from './store/simulationStore';
import { useUIStore } from './store/uiStore';
import { useThemeStore } from './store/themeStore';
import { useCloudShareStore } from './store/cloudShareStore';
import {
  createBroadcastShareBridge,
  isBroadcastSupported,
  type BroadcastShareBridge,
} from './utils/broadcastShare';

/** 把 snapshotCodec 解出的 sim 段映射到 store 的 update* 方法上 */
function applyDecodedSimSlices(sim: Partial<Record<keyof AppStateInput, Record<string, unknown>>>) {
  const s = useSimulationStore.getState();
  const map: Array<[keyof AppStateInput, (patch: Record<string, unknown>) => void]> = [
    ['motorBasics', s.updateMotorBasics as (p: Record<string, unknown>) => void],
    ['threePhase', s.updateThreePhase as (p: Record<string, unknown>) => void],
    ['clarke', s.updateClarke as (p: Record<string, unknown>) => void],
    ['park', s.updatePark as (p: Record<string, unknown>) => void],
    ['pid', s.updatePid as (p: Record<string, unknown>) => void],
    ['svpwm', s.updateSvpwm as (p: Record<string, unknown>) => void],
    ['inverter', s.updateInverter as (p: Record<string, unknown>) => void],
    ['sensorless', s.updateSensorless as (p: Record<string, unknown>) => void],
    ['weakField', s.updateWeakField as (p: Record<string, unknown>) => void],
    ['fault', s.updateFault as (p: Record<string, unknown>) => void],
    ['controlLoop', s.updateControlLoop as (p: Record<string, unknown>) => void],
    ['foc', s.updateFoc as (p: Record<string, unknown>) => void],
    ['hfi', s.updateHfi as (p: Record<string, unknown>) => void],
    ['startup', s.updateStartup as (p: Record<string, unknown>) => void],
    ['apf', s.updateApf as (p: Record<string, unknown>) => void],
    ['refrigeration', s.updateRefrigeration as (p: Record<string, unknown>) => void],
  ];
  let touched = 0;
  for (const [key, fn] of map) {
    const slice = sim[key];
    if (slice && typeof slice === 'object' && typeof fn === 'function') {
      fn(slice);
      touched += 1;
    }
  }
  return touched;
}

/**
 * 接收 .compbench 文件：先尝试当 URL token 解码，失败再当原始 JSON 处理。
 * 拿不到 sim 段就放弃；拿到就 confirm 一次再应用。
 */
function applyIncomingSnapshot(payload: OpenSnapshotPayload) {
  if (!payload || !payload.json) return;
  let decodedSim: Partial<Record<keyof AppStateInput, Record<string, unknown>>> | null = null;
  const label = payload.source ?? translate(getCurrentLocale(), 'shell.snapshotReceivedLabel');

  const trimmed = payload.json.trim();
  // 形式 1：原始 JSON，含 sim 段
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { sim?: Record<string, Record<string, unknown>>; token?: string };
      if (parsed.sim && typeof parsed.sim === 'object') {
        // 已经是长 key 直接用；保持向前兼容用 snapshotCodec 的短 key 也行
        decodedSim = parsed.sim as Partial<Record<keyof AppStateInput, Record<string, unknown>>>;
      } else if (typeof parsed.token === 'string') {
        const decoded = decodeSnapshot(parsed.token);
        if (decoded.ok && decoded.state) decodedSim = decoded.state.sim;
      }
    } catch {
      /* 落到 token 分支 */
    }
  }
  // 形式 2：版本号 + base64 token
  if (!decodedSim) {
    const decoded = decodeSnapshot(trimmed);
    if (decoded.ok && decoded.state) decodedSim = decoded.state.sim;
  }
  if (!decodedSim) {
    window.alert(translate(getCurrentLocale(), 'shell.snapshotUnrecognizedAlert').replace('{label}', label));
    return;
  }

  // 临时确认弹窗：未来若有 ReceiveSnapshotModal，可在此处复用
  const ok = window.confirm(translate(getCurrentLocale(), 'shell.snapshotConfirmApply').replace('{label}', label));
  if (!ok) return;

  const touched = applyDecodedSimSlices(decodedSim);
  if (touched === 0) {
    window.alert(translate(getCurrentLocale(), 'shell.snapshotNoParamsAlert'));
  }
}

function useDesktopMenuSubscriptions() {
  useEffect(() => {
    if (!isDesktopRuntime()) return;

    const bridge = window.motorControlDesktop;
    void syncWindowStateOnce();
    // 启动后把当前主题透给原生菜单 / 系统
    const initialTheme = useThemeStore.getState().theme;
    bridge?.setTheme?.(initialTheme === 'light' ? 'light' : 'dark').catch(() => {});

    const offMenu = subscribeMenu(async (event: DesktopMenuEvent) => {
      switch (event.action) {
        case 'file:new-snapshot':
          useSimulationStore.getState().resetActiveParams();
          useSimulationStore.getState().resetTime();
          break;
        case 'file:save-snapshot': {
          try {
            const state = useSimulationStore.getState() as unknown as Record<string, unknown>;
            const sim: Record<string, unknown> = {};
            for (const key of [
              'motorBasics',
              'threePhase',
              'clarke',
              'park',
              'pid',
              'svpwm',
              'inverter',
              'sensorless',
              'weakField',
              'fault',
              'controlLoop',
              'foc',
              'hfi',
              'startup',
              'apf',
              'refrigeration',
            ]) {
              if (state[key]) sim[key] = state[key];
            }
            const json = JSON.stringify({ version: '1', sim, savedAt: new Date().toISOString() }, null, 2);
            await bridge?.saveSnapshotFile(json);
          } catch (err) {
            console.error('save-snapshot failed', err);
          }
          break;
        }
        case 'file:export-stm32':
          // 触发一个全局 event；ProjectExporter 可以监听打开自身。
          window.dispatchEvent(new CustomEvent('compbench:open-stm32-exporter'));
          break;
        case 'view:toggle-theme': {
          useThemeStore.getState().cycleTheme();
          const next = useThemeStore.getState().theme;
          bridge?.setTheme?.(next === 'light' ? 'light' : 'dark').catch(() => {});
          break;
        }
        case 'view:open-curriculum':
          useUIStore.getState().setSimPanelView('curriculum');
          break;
        case 'help:keybindings':
          window.dispatchEvent(new CustomEvent('compbench:open-keybindings'));
          break;
        case 'help:check-update': {
          try {
            const res = await bridge?.checkForUpdate();
            if (res) {
              window.alert(
                translate(getCurrentLocale(), 'shell.updateCheckAlert')
                  .replace('{cur}', res.currentVersion)
                  .replace('{latest}', res.latestVersion)
                  .replace('{message}', res.message),
              );
            }
          } catch (err) {
            console.error('check-update failed', err);
          }
          break;
        }
        default:
          /* 未识别的 action 忽略 */
          break;
      }
    });

    const offOpen = subscribeOpenSnapshot((payload) => {
      applyIncomingSnapshot(payload);
    });

    return () => {
      offMenu();
      offOpen();
    };
  }, []);
}

/** 解析 `#snapshot=...` hash；返回 token 字符串或空串 */
function readSnapshotHash(): string {
  if (typeof window === 'undefined') return '';
  const m = window.location.hash.match(/#snapshot=([^&]+)/);
  return m ? m[1] : '';
}

/** 清掉 hash，避免下次刷新 / 切换路由再次触发接收 modal */
function clearSnapshotHash(): void {
  if (typeof window === 'undefined') return;
  const { origin, pathname, search } = window.location;
  window.history.replaceState(null, '', `${origin}${pathname}${search}`);
}

/** 启动时和 hashchange 时检查 #snapshot=...，命中且解码成功就弹 ReceiveSnapshotModal */
function useShareHashReceiver() {
  const [pending, setPending] = useState<DecodedSnapshot | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const tryConsume = () => {
      const token = readSnapshotHash();
      if (!token) return;
      const result = decodeSnapshot(token);
      if (result.ok && result.state) {
        setPending(result.state);
        setOpen(true);
      } else {
        clearSnapshotHash();
        console.warn('[snapshot] 接收失败：', result.error);
      }
    };
    tryConsume();
    window.addEventListener('hashchange', tryConsume);
    return () => window.removeEventListener('hashchange', tryConsume);
  }, []);

  const onApply = useCallback(() => {
    if (!pending) return;
    applyDecodedSimSlices(pending.sim);
  }, [pending]);

  const onClose = useCallback(() => {
    setOpen(false);
    clearSnapshotHash();
  }, []);

  return { pending, open, onApply, onClose };
}

/**
 * V2 跨标签页实时协作：仅当 cloudShareStore.realtimeSync = true 时打开
 * BroadcastChannel；收到 patch 消息时把对应 slice 灌进 simulationStore；
 * 自己 send 由具体 UI（参数面板）触发——这里只做"被动接收"，避免每帧 time 写回。
 */
function useBroadcastShareSubscription() {
  const realtimeSync = useCloudShareStore((s) => s.realtimeSync);
  const setConnectedTabs = useCloudShareStore((s) => s.setConnectedTabs);
  const bridgeRef = useRef<BroadcastShareBridge | null>(null);
  const peersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!realtimeSync || !isBroadcastSupported()) {
      setConnectedTabs(1);
      return;
    }
    const bridge = createBroadcastShareBridge({
      onMessage: (msg) => {
        if (msg.kind === 'hello') {
          peersRef.current.add(msg.tabId);
          setConnectedTabs(peersRef.current.size + 1);
          bridge.send({ kind: 'pong', tabId: bridge.tabId });
        } else if (msg.kind === 'bye') {
          peersRef.current.delete(msg.tabId);
          setConnectedTabs(peersRef.current.size + 1);
        } else if (msg.kind === 'ping') {
          bridge.send({ kind: 'pong', tabId: bridge.tabId });
        } else if (msg.kind === 'pong') {
          peersRef.current.add(msg.tabId);
          setConnectedTabs(peersRef.current.size + 1);
        } else if (msg.kind === 'patch') {
          applyDecodedSimSlices({ [msg.slice as keyof AppStateInput]: msg.data });
        }
      },
    });
    bridgeRef.current = bridge;
    // 主动 ping 一次发现已在线的兄弟标签
    const cancelPing = bridge.pingPeers((peer) => {
      peersRef.current.add(peer);
      setConnectedTabs(peersRef.current.size + 1);
    });
    return () => {
      cancelPing();
      bridge.close();
      bridgeRef.current = null;
      peersRef.current.clear();
      setConnectedTabs(1);
    };
  }, [realtimeSync, setConnectedTabs]);
}

export default function App() {
  useDesktopMenuSubscriptions();
  useBroadcastShareSubscription();
  const { pending, open, onApply, onClose } = useShareHashReceiver();
  const { t } = useI18n();
  return (
    <>
      {/* Skip link：键盘 / 屏幕阅读器用户进入页面第一个 Tab 命中此项，
          回车跳到主区，跳过侧栏 / TopBar。WCAG 2.4.1 (Bypass Blocks) AA。 */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:border focus:border-accent-primary focus:bg-bg-surface focus:px-3 focus:py-1.5 focus:text-body focus:text-ink-primary"
      >
        {t('shell.skipToMain')}
      </a>
      <UpdateBanner />
      <AppShell />
      <GlobalKeybindings />
      <ReceiveSnapshotModal open={open} decoded={pending} onApply={onApply} onClose={onClose} />
      <FloatingChatButton />
      <AssistantLazy />
    </>
  );
}

/** 助手面板懒加载壳：首次打开聊天后才 import（RAG 索引链很重），此后常驻。 */
function AssistantLazy() {
  const open = useAssistantStore((s) => s.open);
  const [mounted, setMounted] = useState(false);
  if (open && !mounted) setMounted(true);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <AssistantPanel />
    </Suspense>
  );
}
