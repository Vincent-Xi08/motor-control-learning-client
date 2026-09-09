import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { Cloud, CloudDownload, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useCloudShareStore } from '../../store/cloudShareStore';
import { useI18n } from '../../i18n/useI18n';
import {
  GistError,
  extractGistId,
  listMine,
  type GistMeta,
} from '../../utils/gistCloud';

/**
 * V3 入口：选择 / 输入一个 gist snapshot 用于 PR-style review。
 *
 * 两种入口：
 *   1. 「我的快照」列表（从 GitHub 拉 listMine）—— 适合自有 PAT 的快速选择
 *   2. 「粘贴 gist URL / ID」输入框 —— 适合外部分享 / 团队成员的 gist
 *
 * onPick(gistId) 触发后由调用方负责把 gistId 传给 SnapshotReviewPanel / SnapshotTimeline。
 *
 * 不引入新依赖：用 framer-motion + 与 ReceiveSnapshotModal 一致的 modal 视觉范式。
 * 完整 a11y：role=dialog / aria-modal / Esc 关闭 / focus visible 描边。
 */

interface SnapshotPickerDialogProps {
  open: boolean;
  onPick: (gistId: string) => void;
  onClose: () => void;
}

export function SnapshotPickerDialog({ open, onPick, onClose }: SnapshotPickerDialogProps) {
  const { t } = useI18n();
  const pat = useCloudShareStore((s) => s.pat);

  const [list, setList] = useState<GistMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState('');

  // 校验粘贴的 gist URL / id
  const parsedFromUrl = useMemo(() => extractGistId(urlDraft.trim()), [urlDraft]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const refresh = useCallback(async () => {
    if (!pat) {
      setError(t('share.pickerNeedPat'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const items = await listMine(pat, 30);
      setList(items);
      if (items.length === 0) {
        setError(t('share.pickerNoSnapshotGist'));
      }
    } catch (e) {
      const msg = e instanceof GistError ? e.message : (e as Error).message;
      setError(`${t('share.loadFailPrefix')}${msg}`);
    } finally {
      setLoading(false);
    }
  }, [pat, t]);

  // 打开 dialog 且未加载过时自动拉一次
  useEffect(() => {
    if (open && pat && list.length === 0 && !loading && !error) {
      void refresh();
    }
    // 关闭时清 URL 草稿
    if (!open) {
      setUrlDraft('');
      setUrlError('');
    }
  }, [open, pat, list.length, loading, error, refresh]);

  const handleSubmitUrl = useCallback(() => {
    if (!parsedFromUrl) {
      setUrlError(t('share.pickerBadId'));
      return;
    }
    setUrlError('');
    onPick(parsedFromUrl);
    onClose();
  }, [parsedFromUrl, onPick, onClose, t]);

  const handlePickFromList = useCallback(
    (gistId: string) => {
      onPick(gistId);
      onClose();
    },
    [onPick, onClose],
  );

  return (
    <AnimatePresence>
      {open && (
        <m.div
          key="snapshot-picker-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="snapshot-picker-title"
          className="fixed inset-0 z-[110] grid place-items-center bg-bg-base/70 p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <m.div
            className="scrollbar-thin flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-subtle bg-bg-surface shadow-xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-line-subtle p-4">
              <div className="min-w-0">
                <p className="text-caption uppercase tracking-[0.22em] text-ink-muted">
                  {t('share.pickerHeaderEyebrow')}
                </p>
                <h2
                  id="snapshot-picker-title"
                  className="mt-0.5 font-display text-display text-ink-primary"
                >
                  {t('share.pickerTitle')}
                </h2>
                <p className="mt-1 text-caption text-ink-muted">{t('share.pickerSubtitle')}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('share.pickerCloseAria')}
                className="rounded-lg border border-line-subtle bg-bg-base p-1.5 text-ink-secondary hover:text-ink-primary focus-visible:ring-2 focus-visible:ring-accent-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="flex-1 overflow-auto p-4">
              {/* 入口 1：粘贴 URL / id */}
              <section
                aria-labelledby="picker-url-h"
                className="mb-4 space-y-2 rounded-lg border border-line-subtle bg-bg-base p-3"
              >
                <h3
                  id="picker-url-h"
                  className="text-caption uppercase tracking-[0.18em] text-ink-muted"
                >
                  <CloudDownload className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                  {t('share.pickerPasteHeading')}
                </h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="flex-1">
                    <span className="sr-only">{t('share.pickerUrlSr')}</span>
                    <input
                      type="text"
                      value={urlDraft}
                      onChange={(e) => {
                        setUrlDraft(e.target.value);
                        setUrlError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSubmitUrl();
                        }
                      }}
                      placeholder={t('share.pickerUrlPlaceholder')}
                      aria-label={t('share.pickerUrlInputAria')}
                      aria-invalid={!!urlError}
                      aria-describedby={urlError ? 'picker-url-err' : undefined}
                      className="w-full rounded-lg border border-line-subtle bg-bg-surface px-2 py-1.5 font-mono text-caption text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                    />
                  </label>
                  <Button
                    variant="primary"
                    onClick={handleSubmitUrl}
                    disabled={!parsedFromUrl}
                    aria-label={t('share.pickerUseItAria')}
                  >
                    <CloudDownload className="h-4 w-4" aria-hidden="true" />
                    {t('share.pickerUseIt')}
                  </Button>
                </div>
                {urlError && (
                  <p id="picker-url-err" role="alert" className="text-caption text-accent-fault">
                    {urlError}
                  </p>
                )}
                {parsedFromUrl && (
                  <p className="text-caption text-accent-measure">
                    {t('share.pickerRecognizedPrefix')}
                    <code className="font-mono">{parsedFromUrl.slice(0, 12)}…</code>
                  </p>
                )}
              </section>

              {/* 入口 2：我的快照 */}
              <section
                aria-labelledby="picker-mine-h"
                className="space-y-2 rounded-lg border border-line-subtle bg-bg-base p-3"
              >
                <header className="flex items-center justify-between">
                  <h3
                    id="picker-mine-h"
                    className="text-caption uppercase tracking-[0.18em] text-ink-muted"
                  >
                    <Cloud className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                    {t('share.pickerMineHeading')}
                  </h3>
                  <Button
                    variant="ghost"
                    onClick={() => void refresh()}
                    disabled={loading || !pat}
                    aria-label={t('share.refreshMyGistListAria')}
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {t('share.refreshBtn')}
                  </Button>
                </header>

                {!pat && (
                  <p className="text-caption text-accent-warn">{t('share.pickerNeedPatShort')}</p>
                )}
                {error && pat && (
                  <p role="alert" className="text-caption text-accent-fault">
                    {error}
                  </p>
                )}

                {pat && list.length > 0 && (
                  <ul className="space-y-1.5" aria-label={t('share.pickerListAria')}>
                    {list.map((g) => (
                      <li
                        key={g.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-line-subtle bg-bg-surface px-2.5 py-1.5"
                      >
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-caption ${
                            g.public
                              ? 'border border-accent-measure/40 bg-accent-measure/10 text-accent-measure'
                              : 'border border-accent-warn/40 bg-accent-warn/10 text-accent-warn'
                          }`}
                        >
                          {g.public ? t('share.publicBadge') : t('share.privateBadge')}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-body text-ink-primary"
                            title={g.description}
                          >
                            {g.description || `${t('share.noDescPrefix')}${g.id.slice(0, 8)}…`}
                          </p>
                          <p className="text-caption text-ink-muted">
                            {g.createdAt ? new Date(g.createdAt).toLocaleString('zh-CN') : ''}
                          </p>
                        </div>
                        <Button
                          variant="primary"
                          onClick={() => handlePickFromList(g.id)}
                          aria-label={`${t('share.pickerPickAriaPrefix')}${g.description || g.id.slice(0, 8)}${t('share.pickerPickAriaSuffix')}`}
                          className="px-2 py-0.5 text-caption"
                        >
                          {t('share.pickerPick')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-line-subtle bg-bg-base p-3">
              <Button variant="ghost" onClick={onClose} aria-label={t('share.pickerCancelAria')}>
                {t('common.cancel')}
              </Button>
            </footer>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
