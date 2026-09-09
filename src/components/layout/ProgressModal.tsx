import { AnimatePresence, m } from 'framer-motion';
import { Award, CheckCircle2, Clock, GraduationCap, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useI18n, type TKey } from '../../i18n/useI18n';
import { localizeModuleMeta, moduleMetas } from '../../simulation/engine/presets';
import { useProgressStore } from '../../store/progressStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 用 t 拼接时长（zh "2 小时 5 分" / en "2 h 5 m"）。 */
function formatDuration(ms: number, t: (key: TKey) => string): string {
  if (!ms || ms < 1000) return t('shell.progressTimeZero');
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} ${t('shell.progressTimeHour')} ${m} ${t('shell.progressTimeMinute')}`;
  if (m > 0) return `${m} ${t('shell.progressTimeMinute')} ${s} ${t('shell.progressTimeSecond')}`;
  return `${s} ${t('shell.progressTimeSecond')}`;
}

/** 相对时间（zh "5 分钟前" / en "5 min ago"）。 */
function formatLastVisit(ts: number | null | undefined, t: (key: TKey) => string): string {
  if (!ts) return t('shell.progressNeverVisited');
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return t('shell.progressJustNow');
  if (min < 60) return `${min} ${t('shell.progressMinutesAgo')}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ${t('shell.progressHoursAgo')}`;
  const day = Math.floor(hr / 24);
  return `${day} ${t('shell.progressDaysAgo')}`;
}

/**
 * 全屏学习进度模态。
 *
 * 列出 16 个模块卡片：阶段编号 / 标题 / 访问次数 / 答对数 / 累积时长 / 最近访问。
 * 顶部汇总：访问完成度、总活跃时间、quiz 正确率。
 */
export function ProgressModal({ open, onClose }: Props) {
  const { t, locale } = useI18n();
  const perModule = useProgressStore((s) => s.perModule);
  const totalActiveMs = useProgressStore((s) => s.totalActiveMs);
  const startSession = useProgressStore((s) => s.startSession);
  const reset = useProgressStore((s) => s.reset);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const total = moduleMetas.length;

  const summary = useMemo(() => {
    let visited = 0;
    let completed = 0;          // 至少通关 1 次的模块数（学习深度硬指标）
    let totalCompletions = 0;   // 跨模块通关次数总和（含重复通关）
    let quizCorrect = 0;
    let quizTotal = 0;
    let totalModuleMs = 0;
    for (const meta of moduleMetas) {
      const p = perModule[meta.id];
      if (!p) continue;
      if (p.visited) visited += 1;
      const wc = p.walkthroughCompletions ?? 0;
      if (wc >= 1) completed += 1;
      totalCompletions += wc;
      quizCorrect += p.quizCorrect ?? 0;
      quizTotal += p.quizTotal ?? 0;
      totalModuleMs += p.totalTimeMs ?? 0;
    }
    const accuracy = quizTotal > 0 ? quizCorrect / quizTotal : 0;
    return { visited, completed, totalCompletions, quizCorrect, quizTotal, accuracy, totalModuleMs };
  }, [perModule]);

  const handleReset = () => {
    if (typeof window !== 'undefined' && window.confirm(t('shell.progressResetConfirm'))) {
      reset();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-base/80 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={t('shell.progressDetailsAria')}
        >
          <m.div
            className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-line-subtle bg-bg-surface p-5 shadow-2xl"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle pb-3">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-accent-measure" />
                <h2 className="text-title text-ink-primary">{t('shell.progressTitle')}</h2>
                <span className="text-caption text-ink-muted">
                  {t('shell.progressSessionStart')}
                  {new Date(startSession).toLocaleString(locale)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center gap-1 rounded border border-line-subtle px-2 py-1 text-caption text-ink-muted transition-colors hover:border-accent-fault/60 hover:text-accent-fault"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('curriculum.resetProgress')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-8 w-8 place-items-center rounded border border-line-subtle text-ink-muted transition-colors hover:text-ink-primary"
                  aria-label={t('common.close')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 汇总卡 */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <SummaryCard
                label={t('shell.progressSummaryVisited')}
                value={`${summary.visited}/${total}`}
                hint={t('shell.progressVisitedHint').replace('{n}', String(Math.round((summary.visited / Math.max(1, total)) * 100)))}
                tone="primary"
              />
              <SummaryCard
                label={t('shell.progressSummaryCompleted')}
                value={`${summary.completed}/${total}`}
                hint={
                  summary.totalCompletions > summary.completed
                    ? t('shell.progressCompletionsHint').replace('{n}', String(summary.totalCompletions))
                    : t('shell.progressAllStepsHint')
                }
                tone="measure"
              />
              <SummaryCard
                label={t('shell.progressSummaryQuiz')}
                value={`${summary.quizCorrect}`}
                hint={summary.quizTotal > 0 ? t('shell.progressQuizTotalHint').replace('{n}', String(summary.quizTotal)) : t('shell.progressNoQuizHint')}
                tone="primary"
              />
              <SummaryCard
                label={t('shell.progressSummaryAccuracy')}
                value={summary.quizTotal > 0 ? `${Math.round(summary.accuracy * 100)}%` : '—'}
                hint={t('shell.progressAccuracyHint')}
                tone="warn"
              />
              <SummaryCard
                label={t('shell.progressSummaryDuration')}
                value={formatDuration(summary.totalModuleMs || totalActiveMs, t)}
                hint={t('shell.progressDurationHint')}
                tone="primary"
              />
            </div>

            {/* 模块卡片网格 */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {moduleMetas.map((meta, idx) => {
                const p = perModule[meta.id];
                const visited = p?.visited ?? false;
                const visits = p?.visitCount ?? 0;
                const completions = p?.walkthroughCompletions ?? 0;
                const correct = p?.quizCorrect ?? 0;
                const totalQuiz = p?.quizTotal ?? 0;
                const dwell = p?.totalTimeMs ?? 0;
                const last = p?.lastVisited ?? null;
                // 卡片描边色按学习深度分三档：未访问 → 访问 → 通关
                const border = completions >= 1
                  ? 'border-accent-primary/50 bg-accent-primary/[0.04]'
                  : visited
                    ? 'border-accent-measure/40 bg-bg-base'
                    : 'border-line-subtle bg-bg-base/60';
                return (
                  <m.div
                    key={meta.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(0.4, idx * 0.015) }}
                    className={`rounded-lg border p-2.5 transition-colors ${border}`}
                  >
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-caption text-ink-muted">
                          <span className="tabular-nums">{meta.stage}</span>
                          {visited && !completions && (
                            <CheckCircle2 className="h-3 w-3 text-accent-measure" aria-label={t('shell.progressSummaryVisited')} />
                          )}
                          {completions >= 1 && (
                            <span className="flex items-center gap-0.5 text-accent-primary" title={t('shell.progressCompletedTimes').replace('{n}', String(completions))}>
                              <Award className="h-3 w-3" aria-hidden="true" />
                              <span className="tabular-nums text-[10px]">×{completions}</span>
                            </span>
                          )}
                        </div>
                        <h3 className="truncate text-body font-medium text-ink-primary">
                          {localizeModuleMeta(meta, locale).title}
                        </h3>
                      </div>
                    </div>
                    <p className="mb-2 line-clamp-2 text-caption text-ink-muted">{meta.subtitle}</p>
                    <dl className="grid grid-cols-2 gap-1 text-caption">
                      <div className="flex items-center gap-1 text-ink-muted">
                        <span>{t('shell.progressStatVisited')}</span>
                        <span className="tabular-nums text-ink-primary">{t('shell.progressVisitsCount').replace('{n}', String(visits))}</span>
                      </div>
                      <div className="flex items-center gap-1 text-ink-muted">
                        <span>{t('shell.progressStatCorrect')}</span>
                        <span className="tabular-nums text-accent-measure">
                          {correct}
                          {totalQuiz > 0 && (
                            <span className="text-ink-muted">/{totalQuiz}</span>
                          )}
                        </span>
                      </div>
                      <div className="col-span-2 flex items-center gap-1 text-ink-muted">
                        <Clock className="h-3 w-3" />
                        <span className="tabular-nums text-ink-secondary">
                          {formatDuration(dwell, t)}
                        </span>
                        <span className="ml-auto text-ink-muted">{formatLastVisit(last, t)}</span>
                      </div>
                    </dl>
                  </m.div>
                );
              })}
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  hint: string;
  tone: 'primary' | 'measure' | 'warn';
}

function SummaryCard({ label, value, hint, tone }: SummaryCardProps) {
  const toneClass =
    tone === 'measure'
      ? 'text-accent-measure'
      : tone === 'warn'
        ? 'text-accent-warn'
        : 'text-accent-primary';
  return (
    <div className="rounded-lg border border-line-subtle bg-bg-base p-3">
      <div className="text-caption text-ink-muted">{label}</div>
      <div className={`mt-1 text-display tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-caption text-ink-muted">{hint}</div>
    </div>
  );
}
