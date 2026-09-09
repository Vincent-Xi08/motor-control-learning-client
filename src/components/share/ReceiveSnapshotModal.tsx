import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { X, Check, CircleAlert } from 'lucide-react';
import { useSimulationStore } from '../../store/simulationStore';
import { Button } from '../ui/Button';
import { useFocusTrap } from '../../utils/useFocusTrap';
import { useI18n, translate, getCurrentLocale } from '../../i18n/useI18n';
import {
  packAppState,
  SLICE_LABELS,
  type AppStateInput,
  type DecodedSnapshot,
} from '../../utils/snapshotCodec';

/**
 * 数字孪生接收对比 modal。
 *
 * 进入流程：App.tsx 启动时检查 `window.location.hash`，命中 `#snapshot=...` 解码成功后
 * 把 decoded 推给本组件。**不立即应用** —— 用户必须显式点"应用"才会调用 store update
 * 方法批量灌入。点"取消"或 Esc 关闭，hash 同时被清掉，避免下次刷新再触发。
 *
 * UI：左右两列对照 + diff 高亮（采用 SnapshotDiffPanel 的"●+变色"范式精简版）。
 */

interface ReceiveSnapshotModalProps {
  open: boolean;
  decoded: DecodedSnapshot | null;
  /** 应用：把 decoded 灌进各 store；caller 决定具体策略 */
  onApply: () => void;
  /** 关闭：调用前请清掉 location.hash */
  onClose: () => void;
}

/** 把当前 store snapshot 拍成 AppStateInput（供对照用） */
function pickCurrentInput(): AppStateInput {
  const s = useSimulationStore.getState();
  return packAppState({
    motorBasics: s.motorBasics,
    threePhase: s.threePhase,
    clarke: s.clarke,
    park: s.park,
    pid: s.pid,
    svpwm: s.svpwm,
    inverter: s.inverter,
    sensorless: s.sensorless,
    weakField: s.weakField,
    fault: s.fault,
    controlLoop: s.controlLoop,
    foc: s.foc,
    hfi: s.hfi,
    startup: s.startup,
    apf: s.apf,
    refrigeration: s.refrigeration,
  });
}

/** 简单数值/对象等价比较（用于 diff 标红）。深度=1 够用 */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-6;
  }
  return false;
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (typeof v === 'boolean') return v ? translate(getCurrentLocale(), 'common.yes') : translate(getCurrentLocale(), 'common.no');
  return String(v);
}

interface FieldDiff {
  key: string;
  current: unknown;
  incoming: unknown;
  same: boolean;
}

interface SliceDiff {
  sliceKey: keyof typeof SLICE_LABELS;
  label: string;
  fields: FieldDiff[];
  changedCount: number;
}

function diffSlice(
  sliceKey: keyof typeof SLICE_LABELS,
  current: Record<string, unknown>,
  incoming: Record<string, unknown> | undefined,
): SliceDiff {
  if (!incoming) {
    return { sliceKey, label: SLICE_LABELS[sliceKey], fields: [], changedCount: 0 };
  }
  const allKeys = new Set([...Object.keys(current), ...Object.keys(incoming)]);
  const fields: FieldDiff[] = [];
  let changedCount = 0;
  for (const k of allKeys) {
    const inc = incoming[k];
    if (inc === undefined) continue; // 远端没发的字段不算 diff
    const cur = current[k];
    const same = shallowEqual(cur, inc);
    if (!same) changedCount++;
    fields.push({ key: k, current: cur, incoming: inc, same });
  }
  // 把变化项排在前
  fields.sort((a, b) => Number(a.same) - Number(b.same));
  return { sliceKey, label: SLICE_LABELS[sliceKey], fields, changedCount };
}

export function ReceiveSnapshotModal({ open, decoded, onApply, onClose }: ReceiveSnapshotModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
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

  // Focus trap：open 期间锁住 Tab，关闭还焦点（WCAG 2.4.3 / Section 508 §1194.22(o)）
  useFocusTrap(open && !!decoded, dialogRef);

  const diffs = useMemo<SliceDiff[]>(() => {
    if (!open || !decoded) return [];
    const current = pickCurrentInput();
    const out: SliceDiff[] = [];
    for (const sliceKey of Object.keys(SLICE_LABELS) as Array<keyof typeof SLICE_LABELS>) {
      const curSlice = (current[sliceKey as keyof AppStateInput] as Record<string, unknown>) ?? {};
      const incSlice = decoded.sim[sliceKey as keyof AppStateInput];
      const d = diffSlice(sliceKey, curSlice, incSlice);
      if (d.fields.length > 0) out.push(d);
    }
    return out;
  }, [open, decoded]);

  const totalChanged = diffs.reduce((acc, d) => acc + d.changedCount, 0);
  const hasAsm = !!decoded?.asm;
  const challengeCount = decoded?.ch ? Object.keys(decoded.ch).length : 0;

  const handleApply = useCallback(() => {
    onApply();
    onClose();
  }, [onApply, onClose]);

  return (
    <AnimatePresence>
      {open && decoded && (
        <m.div
          key="receive-snapshot-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="receive-snap-title"
          className="fixed inset-0 z-[110] grid place-items-center bg-bg-base/70 p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <m.div
            ref={dialogRef}
            className="scrollbar-thin flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line-subtle bg-bg-surface shadow-xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-line-subtle p-4">
              <div className="min-w-0">
                <p className="text-caption uppercase tracking-[0.22em] text-ink-muted">
                  {t('share.recvEyebrow')}
                </p>
                <h2
                  id="receive-snap-title"
                  className="mt-0.5 font-display text-display text-ink-primary"
                >
                  {t('share.recvTitle')}
                </h2>
                <p className="mt-1 text-caption text-ink-muted">
                  {t('share.recvTotalPrefix')}
                  <span className="text-accent-primary">{totalChanged}</span>
                  {t('share.recvFieldsDiffSuffix')}
                  {t('share.recvAsmPrefix')}
                  <span className={hasAsm ? 'text-accent-measure' : 'text-ink-muted'}>
                    {hasAsm ? t('share.recvAsmIncluded') : t('share.recvAsmNotIncluded')}
                  </span>{' '}
                  · {t('share.recvChallengePrefix')}
                  <span className="text-ink-secondary">{challengeCount}</span>
                  {t('share.recvChallengeCountSuffix')}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('share.recvCloseAria')}
                className="rounded-lg border border-line-subtle bg-bg-base p-1.5 text-ink-secondary hover:text-ink-primary focus-visible:ring-2 focus-visible:ring-accent-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="flex-1 overflow-auto p-4">
              {diffs.length === 0 ? (
                <div className="rounded-xl border border-line-subtle bg-bg-base p-4 text-center text-body text-ink-muted">
                  <Check className="mx-auto mb-2 h-6 w-6 text-accent-measure" aria-hidden="true" />
                  {t('share.recvIdenticalPrefix')}
                  <span className="text-accent-measure">{t('share.recvIdenticalHighlight')}</span>
                  {t('share.recvIdenticalSuffix')}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="rounded-lg border border-accent-warn/40 bg-accent-warn/5 px-3 py-2 text-caption text-accent-warn">
                    <CircleAlert className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                    {t('share.recvDiffWarning')}
                  </p>
                  {diffs.map((d) => (
                    <section
                      key={d.sliceKey}
                      className="overflow-hidden rounded-xl border border-line-subtle"
                      aria-labelledby={`diff-${d.sliceKey}`}
                    >
                      <header className="flex items-center justify-between bg-bg-base px-3 py-1.5">
                        <h3
                          id={`diff-${d.sliceKey}`}
                          className="text-caption uppercase tracking-[0.18em] text-ink-muted"
                        >
                          {d.label}
                        </h3>
                        <span
                          className={`text-caption ${
                            d.changedCount > 0 ? 'text-accent-primary' : 'text-ink-muted'
                          }`}
                        >
                          {d.changedCount > 0 ? `${d.changedCount}${t('share.recvFieldDiffSuffix')}` : t('share.recvAllSame')}
                        </span>
                      </header>
                      <table className="w-full text-caption">
                        <thead className="bg-bg-base text-ink-muted">
                          <tr>
                            <th scope="col" className="px-2 py-1 text-left">{t('share.recvThField')}</th>
                            <th scope="col" className="px-2 py-1 text-right text-accent-measure">
                              {t('share.recvThCurrent')}
                            </th>
                            <th scope="col" className="px-2 py-1 text-right text-accent-warn">
                              {t('share.recvThRemote')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.fields.map((f) => (
                            <tr
                              key={f.key}
                              className={`border-t border-line-subtle ${
                                !f.same ? 'bg-accent-primary/5' : ''
                              }`}
                            >
                              <th
                                scope="row"
                                className="px-2 py-1 text-left font-mono text-ink-secondary"
                              >
                                {!f.same && (
                                  <span className="mr-1 text-accent-primary" aria-hidden="true">
                                    ●
                                  </span>
                                )}
                                {!f.same && <span className="sr-only">{t('share.recvChangedSr')}</span>}
                                {f.key}
                              </th>
                              <td className="px-2 py-1 text-right font-mono text-ink-primary">
                                {fmtVal(f.current)}
                              </td>
                              <td
                                className={`px-2 py-1 text-right font-mono ${
                                  f.same ? 'text-ink-secondary' : 'text-accent-primary'
                                }`}
                              >
                                {fmtVal(f.incoming)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ))}
                  {hasAsm && decoded?.asm && (
                    <section className="overflow-hidden rounded-xl border border-line-subtle">
                      <header className="bg-bg-base px-3 py-1.5">
                        <h3 className="text-caption uppercase tracking-[0.18em] text-ink-muted">
                          {t('share.recvAsmSectionTitle')}
                        </h3>
                      </header>
                      <ul className="divide-y divide-line-subtle">
                        {Object.entries(decoded.asm).map(([slot, value]) => (
                          <li
                            key={slot}
                            className="flex items-center justify-between px-3 py-1 text-caption"
                          >
                            <span className="font-mono text-ink-secondary">{slot}</span>
                            <span className="font-mono text-accent-warn">{value}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="px-3 py-1.5 text-[10px] text-ink-muted">
                        {t('share.recvAsmSlotNote')}
                      </p>
                    </section>
                  )}
                </div>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle bg-bg-base p-3">
              <Button variant="ghost" onClick={onClose} aria-label={t('share.recvCancelAria')}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleApply}
                disabled={diffs.length === 0}
                aria-label={
                  diffs.length === 0
                    ? t('share.recvApplyAriaIdentical')
                    : `${t('share.recvApplyAriaPrefix')}${totalChanged}${t('share.recvApplyAriaSuffix')}`
                }
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                {t('share.recvApplyPrefix')}
                {totalChanged}
                {t('share.recvApplySuffix')}
              </Button>
            </footer>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
