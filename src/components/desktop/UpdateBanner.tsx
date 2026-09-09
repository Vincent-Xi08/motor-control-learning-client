/**
 * 自动更新顶部 banner —— 仅在 Electron 桌面端可见。
 *
 * 状态机（与 src/utils/desktopBridge.ts::UpdateEventStatus 对齐）：
 *   - 'checking'      正在检查更新…（spinner + 文案）
 *   - 'available'     发现新版本 vX.Y.Z → [立即下载] [暂不更新]
 *   - 'downloading'   下载中 N% → 进度条
 *   - 'downloaded'    下载完成 → [重启并安装] [稍后重启]
 *   - 'not-available' 已是最新版本（5 秒后自动收起）
 *   - 'error'         更新失败：<message> → [关闭]
 *   - 'disabled'      自动更新不可用（dev 模式 / electron-updater 未装），不渲染
 *
 * 视觉：accent.primary（cyan）主态；不写带阴影/光晕的"赛博"装饰。
 * 一致：与 KeyHelpOverlay 同样的 framer-motion 入场（fade + slide）。
 */
import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import {
  checkForUpdateNow,
  dismissUpdateBannerThisSession,
  isDesktopRuntime,
  quitAndInstallUpdate,
  readDismissedBannerVersion,
  startUpdateDownload,
  subscribeUpdateEvents,
  type UpdateEvent,
} from '../../utils/desktopBridge';

// 内部本地状态：基于最新一次 UpdateEvent 派生 UI。
type BannerView =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'available'; latest: string; current: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; latest: string | null }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string };

function eventToView(ev: UpdateEvent, dismissedVersion: string | null): BannerView {
  switch (ev.status) {
    case 'checking':
      return { kind: 'checking' };
    case 'available':
      // 用户本会话内已点"暂不更新"且版本号匹配 → 不再弹
      if (dismissedVersion && (dismissedVersion === '*' || dismissedVersion === ev.latest)) {
        return { kind: 'hidden' };
      }
      return { kind: 'available', latest: ev.latest ?? '?', current: ev.currentVersion };
    case 'downloading':
      return { kind: 'downloading', percent: Math.round(ev.percent ?? 0) };
    case 'downloaded':
      return { kind: 'downloaded', latest: ev.latest ?? null };
    case 'not-available':
      return { kind: 'not-available' };
    case 'error':
      return { kind: 'error', message: ev.message || '未知错误' };
    case 'disabled':
    default:
      // disabled 不打扰用户：banner 完全隐藏
      return { kind: 'hidden' };
  }
}

export function UpdateBanner() {
  const { t } = useI18n();
  const [view, setView] = useState<BannerView>({ kind: 'hidden' });
  const [busy, setBusy] = useState(false);

  // 仅在 Electron 桌面端订阅；Web/dev 完全 noop
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const dismissed = readDismissedBannerVersion();
    const off = subscribeUpdateEvents((ev) => {
      setView(eventToView(ev, dismissed));
    });
    return () => off();
  }, []);

  // not-available 自动 5s 后收起，避免常驻
  useEffect(() => {
    if (view.kind !== 'not-available') return;
    const t = setTimeout(() => setView({ kind: 'hidden' }), 5000);
    return () => clearTimeout(t);
  }, [view.kind]);

  if (!isDesktopRuntime()) return null;
  if (view.kind === 'hidden') return null;

  // 给"立即下载"包一层 busy 锁，避免连点
  async function onDownload() {
    if (busy) return;
    setBusy(true);
    try {
      await startUpdateDownload();
    } finally {
      setBusy(false);
    }
  }

  async function onInstall() {
    if (busy) return;
    setBusy(true);
    try {
      await quitAndInstallUpdate();
    } finally {
      setBusy(false);
    }
  }

  function onDismiss(version: string | null) {
    dismissUpdateBannerThisSession(version);
    setView({ kind: 'hidden' });
  }

  // 重试入口：error / dismissed 后用户主动点"重新检查"
  async function onRecheck() {
    if (busy) return;
    setBusy(true);
    setView({ kind: 'checking' });
    try {
      await checkForUpdateNow();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      <m.div
        key="update-banner"
        role="status"
        aria-live="polite"
        initial={{ y: -32, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -32, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed left-0 right-0 top-0 z-50 border-b border-line-subtle bg-bg-raised/95 px-4 py-2 text-body-small text-ink-primary shadow-sm backdrop-blur-sm"
      >
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-3">
          {view.kind === 'checking' && (
            <>
              <span
                aria-hidden
                className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent-primary"
              />
              <span>{t('shell.updateChecking')}</span>
            </>
          )}

          {view.kind === 'available' && (
            <>
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full bg-accent-primary"
              />
              <span>
                {t('shell.updateFound')} <strong className="font-semibold text-accent-primary">v{view.latest}</strong>
                <span className="ml-2 text-ink-secondary">{t('shell.updateCurrent').replace('{n}', view.current)}</span>
              </span>
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={onDownload}
                  disabled={busy}
                  className="rounded-md border border-accent-primary bg-accent-primary/10 px-3 py-1 text-caption font-medium text-accent-primary transition hover:bg-accent-primary/20 disabled:opacity-50"
                >
                  {t('shell.updateDownloadNow')}
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(view.latest)}
                  className="rounded-md border border-line-subtle px-3 py-1 text-caption text-ink-secondary transition hover:bg-bg-base"
                >
                  {t('shell.updateSkip')}
                </button>
              </span>
            </>
          )}

          {view.kind === 'downloading' && (
            <>
              <span
                aria-hidden
                className="inline-block h-3 w-3 animate-pulse rounded-full bg-accent-primary"
              />
              <span className="min-w-[8rem]">{t('shell.updateDownloading').replace('{n}', String(view.percent))}</span>
              <div
                className="h-1.5 flex-1 overflow-hidden rounded bg-bg-base"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={view.percent}
                aria-label={t('shell.updateProgressAria')}
              >
                <div
                  className="h-full bg-accent-primary transition-all"
                  style={{ width: `${view.percent}%` }}
                />
              </div>
            </>
          )}

          {view.kind === 'downloaded' && (
            <>
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full bg-accent-measure"
              />
              <span>
                {view.latest ? `v${view.latest} ` : ''}{t('shell.updateDownloaded')}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={onInstall}
                  disabled={busy}
                  className="rounded-md border border-accent-primary bg-accent-primary/10 px-3 py-1 text-caption font-medium text-accent-primary transition hover:bg-accent-primary/20 disabled:opacity-50"
                >
                  {t('shell.updateRestartInstall')}
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(view.latest)}
                  className="rounded-md border border-line-subtle px-3 py-1 text-caption text-ink-secondary transition hover:bg-bg-base"
                >
                  {t('shell.updateRestartLater')}
                </button>
              </span>
            </>
          )}

          {view.kind === 'not-available' && (
            <>
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full bg-accent-measure"
              />
              <span>{t('shell.updateUpToDate')}</span>
              <button
                type="button"
                onClick={() => setView({ kind: 'hidden' })}
                className="ml-auto rounded-md border border-line-subtle px-2 py-0.5 text-caption text-ink-secondary transition hover:bg-bg-base"
                aria-label={t('shell.updateCloseAria')}
              >
                ×
              </button>
            </>
          )}

          {view.kind === 'error' && (
            <>
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full bg-accent-fault"
              />
              <span className="truncate">{t('shell.updateFailed')}{view.message === '未知错误' ? t('shell.updateUnknownError') : view.message}</span>
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRecheck}
                  disabled={busy}
                  className="rounded-md border border-line-subtle px-3 py-1 text-caption text-ink-secondary transition hover:bg-bg-base disabled:opacity-50"
                >
                  {t('shell.updateRetry')}
                </button>
                <button
                  type="button"
                  onClick={() => setView({ kind: 'hidden' })}
                  className="rounded-md border border-line-subtle px-2 py-0.5 text-caption text-ink-secondary transition hover:bg-bg-base"
                  aria-label={t('common.close')}
                >
                  ×
                </button>
              </span>
            </>
          )}
        </div>
      </m.div>
    </AnimatePresence>
  );
}

// 仅供单测使用的纯函数导出
export const __testing = { eventToView };
