import { m } from 'framer-motion';
import { ArrowRight, CheckCircle2, Cpu, RotateCw } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { AssetHero } from '../../components/layout/AssetHero';
import { ConceptNotes } from '../../components/layout/ConceptNotes';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { CodeLabCard } from '../../components/lab/CodeLabCard';
import { Card } from '../../components/ui/Card';
import { FidelityBadge } from '../../components/ui/FidelityBadge';
import { Tabs } from '../../components/ui/Tabs';
import { PWMChart } from '../../components/charts/PWMChart';
import { VectorPlane } from '../../components/charts/VectorPlane';
import { Inverter3D } from '../../components/three/Inverter3D';
import { FocCurrentLoopChart } from '../../components/charts/FocCurrentLoopChart';
import { createFocFlowSnapshot, type FOCStep } from '../../simulation/engine/focFlow';
import { useSimulationStore } from '../../store/simulationStore';
import { formatNumber } from '../../utils/format';
import { motionEase } from '../../utils/motion';
import { useI18n } from '../../i18n/useI18n';

// 3D αβ-dq 矢量空间：lazy 加载，避免把 three 拖进首屏关键路径
const RotorFluxScene = lazy(() => import('../../components/three/RotorFluxScene').then((m) => ({ default: m.RotorFluxScene })));

function VectorSpace3DCard({
  alpha,
  beta,
  d,
  q,
  theta,
  enabled,
  onToggle,
}: {
  alpha: number;
  beta: number;
  d: number;
  q: number;
  theta: number;
  enabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card
      title={t('focFlow.title3D')}
      eyebrow={t('focFlow.moduleEyebrow')}
      density="compact"
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={enabled}
            aria-label={enabled ? t('focFlow.toggleOn3D') : t('focFlow.toggleOff3D')}
            onClick={onToggle}
            className={`rounded-full border px-3 py-1 text-caption transition-colors ${
              enabled
                ? 'border-accent-primary/60 bg-accent-primary/10 text-accent-primary'
                : 'border-line-subtle bg-bg-base text-ink-secondary hover:border-line-strong hover:text-ink-primary'
            }`}
          >
            {enabled ? t('focFlow.toggleOn3D') : t('focFlow.toggleOff3D')}
          </button>
          <FidelityBadge level="exact" hint={t('focFlow.vectorsFidelityHint')} />
        </div>
      }
    >
      <p className="mb-2 text-caption leading-relaxed text-ink-secondary">{t('focFlow.note3D')}</p>
      {enabled ? (
        <Suspense
          fallback={
            <div className="flex h-[320px] items-center justify-center rounded-2xl border border-line-subtle bg-bg-base text-caption text-ink-muted">
              {t('focFlow.loadingScene')}
            </div>
          }
        >
          <RotorFluxScene theta={theta} id={d} iq={q} iAlpha={alpha} iBeta={beta} />
        </Suspense>
      ) : (
        <div className="flex h-[200px] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line-subtle bg-bg-base text-center text-caption text-ink-muted">
          <p>{t('focFlow.toggleOff3D')}</p>
        </div>
      )}
    </Card>
  );
}

function StepNode({ step, active, done, pulsing, onClick }: { step: FOCStep; active: boolean; done: boolean; pulsing: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative w-full rounded-xl border p-3 text-left transition-colors ${
        active
          ? 'border-accent-primary/60 bg-accent-primary/10'
          : done
            ? 'border-accent-measure/30 bg-accent-measure/[0.05]'
            : 'border-line-subtle bg-bg-base hover:border-line-strong'
      }`}
    >
      {active && pulsing && (
        <m.span
          className="absolute -top-px left-3 h-px w-12 bg-gradient-to-r from-accent-primary via-accent-measure to-transparent"
          initial={{ x: -12, opacity: 0.3 }}
          animate={{ x: [0, 24, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: motionEase.pulse }}
        />
      )}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h3 className="text-body font-medium text-ink-primary">{step.title}</h3>
        {done ? <CheckCircle2 className="h-4 w-4 text-accent-measure" /> : <Cpu className="h-4 w-4 text-accent-primary" />}
      </div>
      <p className="formula rounded bg-bg-surface px-2 py-1 text-caption text-accent-primary">{step.formula}</p>
      <p className="mt-1.5 text-caption leading-relaxed text-ink-secondary">{step.note}</p>
    </button>
  );
}

function ProbeRow({ entries }: { entries: Record<string, number | string> }) {
  return (
    <div className="space-y-1">
      {Object.entries(entries).map(([key, value]) => (
        <div key={key} className="flex items-center justify-between rounded border border-line-subtle bg-bg-base px-2.5 py-1.5">
          <span className="text-caption text-ink-muted">{key}</span>
          <span className="formula text-body text-ink-primary">{value}</span>
        </div>
      ))}
    </div>
  );
}

function useSnapshot() {
  const threePhase = useSimulationStore((s) => s.threePhase);
  const park = useSimulationStore((s) => s.park);
  const pid = useSimulationStore((s) => s.pid);
  const time = useSimulationStore((s) => s.time);
  return useMemo(() => createFocFlowSnapshot(threePhase, park, pid, time), [threePhase, park, pid, time]);
}

function CurrentLoopView() {
  const foc = useSimulationStore((s) => s.foc);
  const { t } = useI18n();
  const [hd, setHd] = useState(false);
  const [tempC, setTempC] = useState(25);
  return (
    <Card
      title={t('focFlow.loopTitle')}
      eyebrow={t('focFlow.loopEyebrow')}
      density="compact"
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={hd}
            onClick={() => setHd((v) => !v)}
            className={`rounded-full border px-3 py-1 text-caption transition-colors ${
              hd
                ? 'border-accent-measure/60 bg-accent-measure/10 text-accent-measure'
                : 'border-line-subtle bg-bg-base text-ink-secondary hover:border-line-strong'
            }`}
          >
            {hd ? t('focFlow.hdPhysicsOn') : t('focFlow.simpleModel')}
          </button>
          <FidelityBadge level="physical" hint={t('focFlow.loopFidelityHint')} />
        </div>
      }
    >
      <p className="mb-2 text-caption leading-relaxed text-ink-secondary">{t('focFlow.loopHint')}</p>
      {hd && (
        <label className="mb-3 block">
          <span className="mb-1 flex items-baseline justify-between text-caption text-ink-muted">
            <span>{t('focFlow.windingTemp')}</span>
            <span className="formula text-ink-primary">{tempC}</span>
          </span>
          <input
            type="range"
            value={tempC}
            min={-20}
            max={130}
            step={5}
            onChange={(e) => setTempC(Number(e.target.value))}
            className="simulation-slider w-full"
            aria-label={t('focFlow.windingTempAria')}
            aria-valuemin={-20}
            aria-valuemax={130}
            aria-valuenow={tempC}
            aria-valuetext={`${tempC} °C`}
          />
        </label>
      )}
      <FocCurrentLoopChart params={foc} highFidelity={hd} windingTempC={tempC} />
    </Card>
  );
}

function PipelineView({
  manualStepIndex,
  setManualStepIndex,
}: {
  manualStepIndex: number | null;
  setManualStepIndex: (i: number | null) => void;
}) {
  const running = useSimulationStore((s) => s.running);
  const snapshot = useSnapshot();
  const { t } = useI18n();
  const locked = manualStepIndex !== null;
  const displayIndex = manualStepIndex ?? snapshot.activeIndex;
  return (
    <Card
      title={t('focFlow.pipelineTitle')}
      eyebrow={t('focFlow.pipelineEyebrow')}
      density="compact"
      action={<FidelityBadge level="exact" hint={t('focFlow.pipelineFidelityHint')} />}
    >
      <div className="mb-2 flex items-center justify-between rounded-lg border border-line-subtle bg-bg-base px-3 py-1.5 text-caption text-ink-muted">
        <span>{t('focFlow.pipelineHint')}</span>
        {locked && (
          <button
            onClick={() => setManualStepIndex(null)}
            className="rounded border border-accent-measure/40 px-2 py-0.5 text-accent-measure transition-colors hover:bg-accent-measure/10"
          >
            {t('focFlow.pipelineUnlock')}
          </button>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.steps.map((step, index) => (
          <div key={step.id} className="relative">
            <StepNode
              step={step}
              active={index === displayIndex}
              done={!locked && running ? index < snapshot.activeIndex : index < displayIndex}
              pulsing={!locked && running}
              onClick={() => setManualStepIndex(index)}
            />
            {index < snapshot.steps.length - 1 && index % 3 < 2 && (
              <ArrowRight className="absolute -right-2 top-1/2 hidden h-3 w-3 -translate-y-1/2 text-line-strong xl:block" />
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Probe({ manualStepIndex, view }: { manualStepIndex: number | null; view: 'pipeline' | 'loop' }) {
  const running = useSimulationStore((s) => s.running);
  const park = useSimulationStore((s) => s.park);
  const snapshot = useSnapshot();
  const { t, locale } = useI18n();
  const locked = manualStepIndex !== null;
  const displayIndex = manualStepIndex ?? snapshot.activeIndex;
  const activeStep = snapshot.steps[displayIndex];
  // 3D 矢量空间默认关闭：避免首屏 mount three.js 触发 Chromium GL_CLOSE_PATH_NV 警告，
  // 同时让 first-meaningful-paint 更快；用户点开关后才 lazy 加载 three chunk。
  const [show3D, setShow3D] = useState(false);
  if (view === 'pipeline') {
    return (
      <>
        <Card title={t('focFlow.probeTitle')} eyebrow={t('focFlow.probeEyebrow')} density="compact">
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent-primary/30 bg-accent-primary/[0.06] px-3 py-2">
            <RotateCw className={`h-4 w-4 text-accent-primary ${running && !locked ? 'animate-spin' : ''}`} style={{ animationDuration: '2s' }} />
            <div>
              <p className="text-body font-medium text-ink-primary">{activeStep.title}</p>
              <p className="text-caption leading-relaxed text-ink-secondary">{activeStep.note}</p>
              {locale === 'en-US' && (
                <p className="mt-0.5 text-[10px] text-ink-muted">{t('common.translationPending')}</p>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-caption text-ink-muted">{t('focFlow.probeInput')}</p>
              <ProbeRow entries={activeStep.input} />
            </div>
            <div>
              <p className="mb-1 text-caption text-ink-muted">{t('focFlow.probeOutput')}</p>
              <ProbeRow entries={activeStep.output} />
            </div>
          </div>
        </Card>
        <Card title={t('focFlow.vectorCardTitle')} eyebrow={t('focFlow.vectorCardEyebrow')} density="compact">
          <VectorPlane
            alpha={snapshot.alphaBeta.alpha}
            beta={snapshot.alphaBeta.beta}
            d={snapshot.dq.d}
            q={snapshot.dq.q}
            theta={(park.thetaDeg * Math.PI) / 180}
            showDqAxes
            title={t('focFlow.vectorCardTitle')}
            max={10}
          />
        </Card>
        <div className="grid gap-2 md:grid-cols-2">
          <Card title={t('focFlow.svpwmOutTitle')} eyebrow={t('focFlow.svpwmOutEyebrow')} density="compact">
            <PWMChart dutyA={snapshot.svpwm.dutyA} dutyB={snapshot.svpwm.dutyB} dutyC={snapshot.svpwm.dutyC} />
            <p className="formula mt-2 text-caption text-ink-secondary">{t('focFlow.svpwmSummary')} {snapshot.svpwm.sector} · m={formatNumber(snapshot.svpwm.modulationIndex, 3)} · {snapshot.svpwm.saturated ? t('common.yes') : t('common.no')}</p>
          </Card>
          <Card title={t('focFlow.inverterTitle')} eyebrow={t('focFlow.inverterEyebrow')} density="compact">
            <Inverter3D dutyA={snapshot.svpwm.dutyA} dutyB={snapshot.svpwm.dutyB} dutyC={snapshot.svpwm.dutyC} />
          </Card>
        </div>
        <VectorSpace3DCard
          alpha={snapshot.alphaBeta.alpha}
          beta={snapshot.alphaBeta.beta}
          d={snapshot.dq.d}
          q={snapshot.dq.q}
          theta={(park.thetaDeg * Math.PI) / 180}
          enabled={show3D}
          onToggle={() => setShow3D((v) => !v)}
        />
        <CodeLabCard />
      </>
    );
  }
  // 'loop' 视图：把闭环响应右侧空间留给"调参提示"+"αβ/dq"
  return (
    <>
      <Card title={t('focFlow.tuningTitle')} eyebrow={t('focFlow.tuningEyebrow')} density="compact">
        <ul className="space-y-2 text-body leading-relaxed text-ink-secondary">
          <li>{t('focFlow.tipKpLow')}</li>
          <li>{t('focFlow.tipKpHigh')}</li>
          <li>{t('focFlow.tipKiLow')}</li>
          <li>{t('focFlow.tipThetaErr')}</li>
          <li>{t('focFlow.tipOmegaHigh')}</li>
          <li>{t('focFlow.tipDelay')}</li>
        </ul>
      </Card>
      <Card title={t('focFlow.vectorSnapshotTitle')} eyebrow={t('focFlow.vectorSnapshotEyebrow')} density="compact">
        <VectorPlane
          alpha={snapshot.alphaBeta.alpha}
          beta={snapshot.alphaBeta.beta}
          d={snapshot.dq.d}
          q={snapshot.dq.q}
          theta={(park.thetaDeg * Math.PI) / 180}
          showDqAxes
          title={t('focFlow.vectorCardTitle')}
          max={10}
        />
      </Card>
      <VectorSpace3DCard
        alpha={snapshot.alphaBeta.alpha}
        beta={snapshot.alphaBeta.beta}
        d={snapshot.dq.d}
        q={snapshot.dq.q}
        theta={(park.thetaDeg * Math.PI) / 180}
        enabled={show3D}
        onToggle={() => setShow3D((v) => !v)}
      />
      <CodeLabCard />
    </>
  );
}

export function FOCFlowModule() {
  const { t } = useI18n();
  const [manualStepIndex, setManualStepIndex] = useState<number | null>(null);
  const [view, setView] = useState<'pipeline' | 'loop'>('loop');
  return (
    <ModuleLayout
      primary={
        <div className="space-y-3">
          <AssetHero moduleId="foc-flow" />
          <Tabs
            value={view}
            onChange={setView}
            options={[
              { value: 'loop', label: t('focFlow.tabLoop') },
              { value: 'pipeline', label: t('focFlow.tabPipeline') },
            ]}
          />
          {view === 'loop' ? (
            <CurrentLoopView />
          ) : (
            <PipelineView manualStepIndex={manualStepIndex} setManualStepIndex={setManualStepIndex} />
          )}
        </div>
      }
      probe={<Probe manualStepIndex={manualStepIndex} view={view} />}
      concept={<ConceptNotes moduleId="foc-flow" />}
    />
  );
}
