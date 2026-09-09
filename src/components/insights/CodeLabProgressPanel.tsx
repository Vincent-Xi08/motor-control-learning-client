import { CheckCircle2, Circle, Code2 } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { codeChallenges } from '../../content/codelab/index';
import { useCodelabStore } from '../../store/codelabStore';

/**
 * 编程实验室进度面板：订阅 codelabStore 的通关状态（persist 到
 * localStorage `compressor-bench-codelab`），展示 16 题进度与逐题清单。
 * 模块页通关 → store 更新 → 本面板实时响应（同页签内）。
 */
export function CodeLabProgressPanel() {
  const { t, locale } = useI18n();
  const solvedMap = useCodelabStore((s) => s.solved);

  const solved = codeChallenges.filter((ch) => solvedMap[ch.id]).length;
  const total = codeChallenges.length;
  const pct = total > 0 ? Math.round((solved / total) * 100) : 0;

  return (
    <section
      className="rounded-xl border border-line-subtle bg-bg-surface p-4"
      aria-label={t('insights.codeLabPanelAria')}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-body font-medium text-ink-primary">
          <Code2 className="h-4 w-4 text-accent-primary" aria-hidden="true" />
          {t('insights.codeLabPanelTitle')}
        </h3>
        <p className="formula text-caption text-ink-secondary">
          {solved}/{total} · {pct}%
        </p>
      </div>

      <div
        className="mb-3 h-2 overflow-hidden rounded-full bg-line-subtle"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('insights.codeLabPanelAria')}
      >
        <div
          className="h-full rounded-full bg-accent-measure/70 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {codeChallenges.map((ch) => {
          const done = Boolean(solvedMap[ch.id]);
          return (
            <li
              key={ch.id}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-caption ${
                done
                  ? 'border-accent-measure/30 bg-accent-measure/[0.06] text-ink-primary'
                  : 'border-line-subtle bg-bg-base text-ink-muted'
              }`}
            >
              {done
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent-measure" aria-hidden="true" />
                : <Circle className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />}
              <span className="truncate">
                {(locale === 'en-US' ? ch.title['en-US'] : ch.title['zh-CN']).replace(/^[^：:]*[：:]\s*/, '')}
              </span>
              <span className="ml-auto shrink-0 text-[10px] tracking-widest text-ink-muted">
                {'★'.repeat(ch.difficulty)}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-caption leading-relaxed text-ink-muted">
        {t('insights.codeLabPanelHint')}
      </p>
    </section>
  );
}
