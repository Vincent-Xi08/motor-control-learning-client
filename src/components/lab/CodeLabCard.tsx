import { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Lightbulb, Play, RotateCcw, KeyRound, Terminal } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '../ui/Card';
import { CodeBlock } from '../layout/CodeBlock';
import { SafeResponsiveContainer } from '../charts/SafeResponsiveContainer';
import { useI18n } from '../../i18n/useI18n';
import { usePersistentState } from '../../utils/usePersistentState';
import { runChallenge, runSweep, type RunResult, type SweepResult } from '../../simulation/codelab/runner';
import { codeChallenges } from '../../content/codelab/index';
import { codeLabSolutions } from '../../content/codelab/solutions';
import { useSimulationStore } from '../../store/simulationStore';
import { useCodelabStore } from '../../store/codelabStore';

/**
 * 编程实验室卡：当前模块的动手编程挑战。
 *
 * 学员在编辑器里实现算法函数 → 浏览器内判题（期望值由 src/simulation/math
 * 参考实现冻结）→ 全过后解锁 STM32 C 参考实现。代码 / 通过状态按题持久化。
 */
export function CodeLabCard() {
  const moduleId = useSimulationStore((s) => s.activeModule);
  const challenges = useMemo(() => codeChallenges.filter((c) => c.moduleId === moduleId), [moduleId]);
  const { t, locale } = useI18n();

  if (challenges.length === 0) return null;

  return (
    <>
      {challenges.map((ch) => (
        <SingleChallenge key={ch.id} challengeId={ch.id} t={t} locale={locale} />
      ))}
    </>
  );
}

function SingleChallenge({
  challengeId,
  t,
  locale,
}: {
  challengeId: string;
  t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0]) => string;
  locale: 'zh-CN' | 'en-US';
}) {
  const challenge = useMemo(() => codeChallenges.find((c) => c.id === challengeId), [challengeId]);
  // 起手代码按 locale 取：en-US 用 starterEn（缺失回退中文版）。
  // 持久化 key 不含 locale——已保存的代码在切换语言后保持原样，不自动迁移（可接受）；
  // 重置按钮会把编辑器刷回当前 locale 的起手代码。
  const starter = locale === 'en-US' ? (challenge?.starterEn ?? challenge?.starter) : challenge?.starter;
  const [code, setCode] = usePersistentState(`codelab.code.${challengeId}`, starter ?? '');
  const [result, setResult] = useState<RunResult | null>(null);
  const [hintsShown, setHintsShown] = usePersistentState(`codelab.hints.${challengeId}`, 0);
  const solved = useCodelabStore((s) => Boolean(s.solved[challengeId]));
  const markSolved = useCodelabStore((s) => s.markSolved);
  const [showSolution, setShowSolution] = useState(false);
  const [showCRef, setShowCRef] = useState(false);
  const [sweep, setSweep] = useState<SweepResult | null>(null);

  if (!challenge) return null;

  const run = () => {
    const r = runChallenge(challenge, code);
    setResult(r);
    if (r.ok) {
      markSolved(challengeId);
      // 通关即算曲线：把学员函数在扫描区间上逐点跑一遍（有 sweep 定义的题）
      setSweep(challenge.sweep ? runSweep(challenge, code, challenge.sweep) : null);
    } else {
      setSweep(null);
    }
  };

  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(4));
  const pick = (entry: { 'zh-CN': string; 'en-US': string }) => entry[locale] ?? entry['zh-CN'];

  return (
    <Card
      title={pick(challenge.title)}
      eyebrow={`code lab · difficulty ${'★'.repeat(challenge.difficulty)}`}
      density="compact"
      action={
        solved ? (
          <span className="inline-flex items-center gap-1 rounded border border-accent-measure/40 bg-accent-measure/10 px-2 py-0.5 text-caption text-accent-measure">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('lab.codeLabSolved')}
          </span>
        ) : undefined
      }
    >
      <p className="mb-3 text-caption leading-relaxed text-ink-secondary">{pick(challenge.statement)}</p>

      <label className="block">
        <span className="sr-only">{t('lab.codeLabEditorAria')}</span>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          rows={Math.min(14, Math.max(6, code.split('\n').length + 1))}
          aria-label={t('lab.codeLabEditorAria')}
          className="w-full resize-y rounded-lg border border-line-subtle bg-bg-base p-3 font-mono text-[12px] leading-relaxed text-ink-primary focus:border-accent-primary/50 focus:outline-none"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          className="inline-flex items-center gap-1.5 rounded border border-accent-primary/50 bg-accent-primary/15 px-3 py-1 text-caption text-accent-primary transition-colors hover:bg-accent-primary/25"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {t('lab.codeLabRun')}
        </button>
        <button
          type="button"
          onClick={() => { setCode(starter ?? ''); setResult(null); }}
          className="inline-flex items-center gap-1.5 rounded border border-line-subtle bg-bg-base px-3 py-1 text-caption text-ink-muted transition-colors hover:text-ink"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('lab.codeLabReset')}
        </button>
        {challenge.hints.length > 0 && (
          <button
            type="button"
            onClick={() => setHintsShown(Math.min(challenge.hints.length, hintsShown + 1))}
            disabled={hintsShown >= challenge.hints.length}
            className="inline-flex items-center gap-1.5 rounded border border-accent-warn/40 bg-accent-warn/10 px-3 py-1 text-caption text-accent-warn transition-colors hover:bg-accent-warn/20 disabled:opacity-40"
          >
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
            {t('lab.codeLabHint')} {hintsShown}/{challenge.hints.length}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowCRef((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-line-subtle bg-bg-base px-3 py-1 text-caption text-ink-muted transition-colors hover:text-ink"
        >
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          {showCRef ? t('lab.codeLabHideC') : t('lab.codeLabShowC')}
        </button>
      </div>

      {hintsShown > 0 && (
        <ul className="mt-2 space-y-1">
          {challenge.hints.slice(0, hintsShown).map((h, i) => (
            <li key={i} className="rounded border border-accent-warn/25 bg-accent-warn/[0.06] px-2 py-1 text-caption leading-relaxed text-ink-secondary">
              <span className="mr-1 text-accent-warn">💡{i + 1}</span>{pick(h)}
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div className="mt-3 rounded-lg border border-line-subtle bg-bg-base p-2">
          {result.fatalError ? (
            <p className="text-caption text-accent-fault">{t('lab.codeLabFatal')} {result.fatalError}</p>
          ) : (
            <>
              <p className={`mb-2 text-caption font-medium ${result.ok ? 'text-accent-measure' : 'text-ink-secondary'}`}>
                {result.ok ? t('lab.codeLabAllPass') : t('lab.codeLabPassedOf').replace('{p}', String(result.passed)).replace('{n}', String(result.total))}
              </p>
              <ul className="space-y-1">
                {result.results.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-caption leading-snug">
                    {r.pass
                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-measure" aria-hidden="true" />
                      : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-fault" aria-hidden="true" />}
                    <span className="text-ink-secondary">
                      <span className="font-mono text-[11px] text-ink-primary">{challenge.cases[i].label}</span>
                      {!r.pass && (
                        <span className="ml-2 font-mono text-[11px]">
                          {t('lab.codeLabGot')}
                          {' '}
                          {(r.actual.length ? r.actual : [NaN]).map(fmt).join(', ')}
                          {' · '}
                          {t('lab.codeLabExpected')}
                          {' '}
                          {r.expected.map(fmt).join(', ')}
                          {r.message ? ` · ${r.message}` : ''}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {result?.ok && (
        <p className="mt-2 text-caption text-accent-measure">🎉 {t('lab.codeLabCongrats')}</p>
      )}

      {/* 通关后的扫描可视化：你的曲线（实线）vs 参考实现（虚线） */}
      {result?.ok && challenge.sweep && sweep && (
        <div className="mt-3 rounded-xl border border-line-subtle bg-bg-base p-2">
          <p className="mb-1 text-caption font-medium text-ink-primary">{t('lab.codeLabSweepTitle')}</p>
          {(() => {
            const sw = challenge.sweep;
            return sweep.ok ? (
            <>
              <div className="h-52">
                <SafeResponsiveContainer>
                  <LineChart
                    data={sweepChart(sw, sweep.curve, t('lab.codeLabSweepYou'), t('lab.codeLabSweepRef'))}
                    margin={{ top: 6, right: 14, bottom: 16, left: -4 }}
                  >
                    <CartesianGrid stroke="rgba(231,243,255,0.06)" strokeDasharray="3 6" />
                    <XAxis
                      dataKey="x" type="number" domain={['dataMin', 'dataMax']}
                      tick={{ fill: '#9eb5cb', fontSize: 11 }}
                      label={{ value: sw.xLabel, position: 'insideBottom', offset: -6, fill: '#9eb5cb', fontSize: 11 }}
                    />
                    <YAxis tick={{ fill: '#9eb5cb', fontSize: 11 }} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ background: '#0c1524', border: '1px solid #1b2740', borderRadius: 8, color: '#eaf3ff', fontSize: 11 }}
                      labelFormatter={(v) => `${sw.xLabel} = ${Number(v).toFixed(3)}`}
                      formatter={(v) => Number(v).toFixed(3)}
                    />
                    <Legend wrapperStyle={{ fontSize: 10, color: '#9db4cc' }} />
                    {sweepLines(sw, t('lab.codeLabSweepYou'), t('lab.codeLabSweepRef')).map((l) => (
                      <Line key={l.dataKey} {...l} dot={false} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </SafeResponsiveContainer>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-ink-muted">{t('lab.codeLabSweepHint')}</p>
            </>
          ) : (
            <p className="text-caption text-accent-warn">{t('lab.codeLabSweepError')}{sweep.error}</p>
          );
          })()}
        </div>
      )}

      {(showCRef || solved) && (
        <div className="mt-3">
          <p className="mb-1 text-caption text-ink-muted">{solved ? t('lab.codeLabCUnlocked') : t('lab.codeLabCPreview')}</p>
          <CodeBlock code={challenge.cReference} language="C" title="STM32 C" />
        </div>
      )}

      {!solved && (
        <button
          type="button"
          onClick={() => setShowSolution((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-muted underline-offset-2 hover:text-ink-secondary hover:underline"
        >
          <KeyRound className="h-3 w-3" aria-hidden="true" />
          {showSolution ? t('lab.codeLabHideSolution') : t('lab.codeLabShowSolution')}
        </button>
      )}
      {showSolution && !solved && (
        <CodeBlock code={codeLabSolutions[challenge.id] ?? ''} language="TS" title={t('lab.codeLabSolutionTitle')} />
      )}
    </Card>
  );
}

/** 输出线配色（学员=语义色实线，参考=灰虚线），按输出通道循环。 */
const SWEEP_COLORS = ['#3ec8ff', '#3df0b0', '#ffb84d'];

function sweepChart(
  sweep: NonNullable<import('../../content/codelab/types').CodeChallenge['sweep']>,
  curve: number[][],
  youLabel: string,
  refLabel: string,
) {
  const n = Math.min(sweep.reference.length, curve.length);
  return Array.from({ length: n }, (_, i) => {
    const x = sweep.from + ((sweep.to - sweep.from) * i) / (n - 1);
    const row: Record<string, number> = { x: Number(x.toFixed(4)) };
    sweep.outLabels.forEach((_, k) => {
      row[`y${k}`] = curve[i]?.[k] ?? Number.NaN;
      row[`r${k}`] = sweep.reference[i]?.[k] ?? Number.NaN;
    });
    void youLabel; void refLabel;
    return row;
  });
}

function sweepLines(
  sweep: NonNullable<import('../../content/codelab/types').CodeChallenge['sweep']>,
  youLabel: string,
  refLabel: string,
) {
  const lines: Array<{ dataKey: string; stroke: string; name: string; strokeDasharray?: string }> = [];
  sweep.outLabels.forEach((label, k) => {
    lines.push({ dataKey: `y${k}`, stroke: SWEEP_COLORS[k % SWEEP_COLORS.length], name: `${label} · ${youLabel}` });
    lines.push({ dataKey: `r${k}`, stroke: '#7c96b2', name: `${label} · ${refLabel}`, strokeDasharray: '4 4' });
  });
  return lines;
}
