import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Line, LineChart, CartesianGrid, ReferenceLine, ReferenceDot, Tooltip, XAxis, YAxis } from 'recharts';
import { X, CircuitBoard, Cpu, Snowflake, Wrench, Play, AlertTriangle, CheckCircle2, AlertCircle, ChevronDown, Activity, Sparkles, Trophy, Lightbulb, Target, Zap, Filter, Save, Trash2, ArrowRightCircle, FileCode, History, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { compressorBundles, type CompressorSpec, type InverterPlatform } from '../../content/compressorLibrary';
import {
  controlStrategies,
  inverterPlatforms,
  liquidSeparators,
  loadConditions,
  pfcPlatforms,
  runAssembly,
  type AssemblyResult,
  type AssemblyTimeline,
  type ControlStrategy,
  type LiquidSeparator,
  type LoadCondition,
  type PfcPlatform,
} from '../../content/assemblyLibraries';
import {
  assemblyChallenges,
  checkChallengePass,
  challengeProgress,
  lookupChallengeIndices,
  type AssemblyChallenge,
} from '../../content/assemblyChallenges';
import { exportAssemblyAsC } from '../../content/assemblyExport';
// SystemSchematic 是 ~28KB 的复杂 SVG 拓扑图，仅在 AssemblyWorkshop 主视图渲染。
// 切 lazy 之后挑战 / 历史 tab 切换 + 弹窗关闭都不会再付这个解析成本，
// 也让 AssemblyWorkshopModule 主 chunk 进一步瘦身。
const SystemSchematic = lazy(() =>
  import('./SystemSchematic').then((m) => ({ default: m.SystemSchematic })),
);
import { SafeResponsiveContainer } from '../charts/SafeResponsiveContainer';
import { useSimulationStore } from '../../store/simulationStore';
import { useAssemblyProgressStore, type AssemblyHistoryEntry, type AssemblySnapshot } from '../../store/assemblyProgressStore';
import { useReplayStore } from '../../store/replayStore';
import { downloadText, timestamp } from '../../utils/download';
import { useI18n, type TKey } from '../../i18n/useI18n';

interface Props {
  /** 模态浮层模式：受控显示/关闭。embedded 时这俩字段可不传 */
  open?: boolean;
  onClose?: () => void;
  /** 嵌入式（模块页）模式：跳过 modal 壳 + 关闭按钮 + ESC，始终视为打开 */
  embedded?: boolean;
}

/**
 * 整机搭建工作台 ——
 *
 * 6 个槽位（压缩机 / 变频器 / 控制策略 / 工况 / PFC / 液气分离器），每槽位下拉选择；
 * 点击"运行整机仿真"用 runAssembly 跑稳态诊断 + 8 秒时域仿真，列出 ok/warn/fault + 时间线。
 *
 * 两种渲染方式：
 *  - 浮层（Sidebar 快捷按钮）：open=true / onClose 触发关闭
 *  - 嵌入式（17 号模块页）：embedded=true 跳过 modal 壳
 */
export function AssemblyWorkshop({ open, onClose, embedded = false }: Props) {
  const { t, locale } = useI18n();
  const isVisible = embedded || open;
  // 4 槽位的当前选择 —— 默认用第一个压缩机 bundle 的搭配
  const defaultBundle = compressorBundles[0];
  const [compressorIdx, setCompressorIdx] = useState(0);
  const [inverterIdx, setInverterIdx] = useState(() => inverterPlatforms.findIndex((i) => i.ipmPartNo === defaultBundle.inverter.ipmPartNo) || 0);
  const [strategyIdx, setStrategyIdx] = useState(3);  // 默认 FOC + HFI + BEMF（压缩机标配）
  const [loadIdx, setLoadIdx] = useState(0);          // 默认夏季制冷
  const [pfcIdx, setPfcIdx] = useState(1);            // 默认 Boost 单相 PFC
  const [separatorIdx, setSeparatorIdx] = useState(1); // 默认 标准液气分离器

  // 模式 + 挑战状态（本会话临时状态）
  const [mode, setMode] = useState<'sandbox' | 'challenge' | 'history'>('sandbox');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  // 解题路径：每次"运行"在挑战模式下都 push 一条记录
  const [attemptHistory, setAttemptHistory] = useState<Array<{ slotIds: AssemblySnapshot['slotIds']; result: AssemblyResult; timestamp: number }>>([]);

  // 持久化通关记录（跨会话）
  const challengeRecords = useAssemblyProgressStore((s) => s.records);
  const recordPass = useAssemblyProgressStore((s) => s.recordPass);
  const resetAllProgress = useAssemblyProgressStore((s) => s.reset);
  const completedChallenges = useMemo(() => new Set(Object.keys(challengeRecords)), [challengeRecords]);

  // 持久化快照（自由搭建模式可保存最多 5 个组合做并排对比）
  const snapshots = useAssemblyProgressStore((s) => s.snapshots);
  const saveSnapshot = useAssemblyProgressStore((s) => s.saveSnapshot);
  const deleteSnapshot = useAssemblyProgressStore((s) => s.deleteSnapshot);

  // 历史会话（每次"运行"自动归档，最多 20 条，跨刷新保留）
  const history = useAssemblyProgressStore((s) => s.history);
  const pushHistory = useAssemblyProgressStore((s) => s.pushHistory);
  const clearHistory = useAssemblyProgressStore((s) => s.clearHistory);

  // Phase C：挑战模式下每次"运行整机仿真"把当时的快照写到 replay store（跨刷新持久化）
  const pushReplayStep = useReplayStore((s) => s.pushStep);

  const challenge = useMemo<AssemblyChallenge | null>(
    () => assemblyChallenges.find((c) => c.id === challengeId) ?? null,
    [challengeId],
  );

  const compressor: CompressorSpec = compressorBundles[compressorIdx].compressor;
  const inverter: InverterPlatform = inverterPlatforms[inverterIdx];
  const strategy: ControlStrategy = controlStrategies[strategyIdx];
  const load: LoadCondition = loadConditions[loadIdx];
  const pfc: PfcPlatform = pfcPlatforms[pfcIdx];
  const separator: LiquidSeparator = liquidSeparators[separatorIdx];

  const [result, setResult] = useState<AssemblyResult | null>(null);

  const refrigerantMismatch = compressor.refrigerant !== load.refrigerant;

  // 进入挑战时把 6 槽位重置为题目的初始配置
  const loadChallenge = (id: string) => {
    const c = assemblyChallenges.find((c) => c.id === id);
    if (!c) return;
    const idx = lookupChallengeIndices(c);
    if (!idx) return;
    setChallengeId(id);
    setMode('challenge');
    setCompressorIdx(idx.compressorIdx);
    setInverterIdx(idx.inverterIdx);
    setStrategyIdx(idx.strategyIdx);
    setLoadIdx(idx.loadIdx);
    setPfcIdx(idx.pfcIdx);
    setSeparatorIdx(idx.separatorIdx);
    setAttempts(0);
    setShowHint(false);
    setJustCompleted(false);
    setResult(null);
    setAttemptHistory([]);   // 新一题，重置路径
  };

  const exitChallenge = () => {
    setMode('sandbox');
    setChallengeId(null);
    setJustCompleted(false);
  };

  // 首次进入或没结果时自动跑一次
  useEffect(() => {
    if (isVisible && !result) {
      setResult(runAssembly({ compressor, inverter, strategy, load, pfc, separator }));
    }
  }, [isVisible, result, compressor, inverter, strategy, load, pfc, separator]);

  // 切换槽位时清掉旧结果
  const handleSlotChange = <T,>(setter: (v: T) => void, value: T) => {
    setter(value);
    setResult(null);
    setJustCompleted(false);
  };

  // 当前 6 槽位的稳定 ID（给 snapshot / runAssemblyFromSnapshot 用）
  const currentSlotIds = useMemo(() => ({
    compressorBundleId: compressorBundles[compressorIdx].id,
    inverterPartNo: inverter.ipmPartNo,
    strategyId: strategy.id,
    loadId: load.id,
    pfcId: pfc.id,
    separatorId: separator.id,
  }), [compressorIdx, inverter, strategy, load, pfc, separator]);

  const handleSaveSnapshot = () => {
    const defaultName = `${compressor.brand.split('（')[0]} ${compressor.hp}HP · ${strategy.id.split('-')[0].toUpperCase()} · ${load.name.split('·')[0].trim()}`;
    const name = window.prompt(t('assemblyWorkshop.promptSnapshotName'), defaultName);
    if (!name) return;
    saveSnapshot(name.slice(0, 60), currentSlotIds);
  };

  const handleExportC = () => {
    // 确保用最新 result 导出（用户切了 slot 但没点 Run）
    const liveResult = result ?? runAssembly({ compressor, inverter, strategy, load, pfc, separator });
    const text = exportAssemblyAsC({ compressor, inverter, strategy, load, pfc, separator, result: liveResult });
    const safeBrand = compressor.brand.replace(/[（）()]/g, '').split(/\s+/)[0];
    const fname = `assembly_${safeBrand}_${compressor.partNo.replace(/[^a-zA-Z0-9]/g, '')}_${timestamp()}.c`;
    downloadText(fname, text);
  };

  // 历史会话回放：套用某条 history 的 slotIds 回到自由搭建
  const handleApplyHistory = (entry: AssemblyHistoryEntry) => {
    const cIdx = compressorBundles.findIndex((b) => b.id === entry.slotIds.compressorBundleId);
    const iIdx = inverterPlatforms.findIndex((i) => i.ipmPartNo === entry.slotIds.inverterPartNo);
    const sIdx = controlStrategies.findIndex((s) => s.id === entry.slotIds.strategyId);
    const lIdx = loadConditions.findIndex((l) => l.id === entry.slotIds.loadId);
    const pIdx = pfcPlatforms.findIndex((p) => p.id === entry.slotIds.pfcId);
    const sepIdx = liquidSeparators.findIndex((s) => s.id === entry.slotIds.separatorId);
    if (cIdx >= 0) setCompressorIdx(cIdx);
    if (iIdx >= 0) setInverterIdx(iIdx);
    if (sIdx >= 0) setStrategyIdx(sIdx);
    if (lIdx >= 0) setLoadIdx(lIdx);
    if (pIdx >= 0) setPfcIdx(pIdx);
    if (sepIdx >= 0) setSeparatorIdx(sepIdx);
    setResult(null);
    setMode('sandbox');
    setChallengeId(null);
  };

  const handleApplySnapshot = (snap: AssemblySnapshot) => {
    const cIdx = compressorBundles.findIndex((b) => b.id === snap.slotIds.compressorBundleId);
    const iIdx = inverterPlatforms.findIndex((i) => i.ipmPartNo === snap.slotIds.inverterPartNo);
    const sIdx = controlStrategies.findIndex((s) => s.id === snap.slotIds.strategyId);
    const lIdx = loadConditions.findIndex((l) => l.id === snap.slotIds.loadId);
    const pIdx = pfcPlatforms.findIndex((p) => p.id === snap.slotIds.pfcId);
    const sepIdx = liquidSeparators.findIndex((s) => s.id === snap.slotIds.separatorId);
    if (cIdx >= 0) setCompressorIdx(cIdx);
    if (iIdx >= 0) setInverterIdx(iIdx);
    if (sIdx >= 0) setStrategyIdx(sIdx);
    if (lIdx >= 0) setLoadIdx(lIdx);
    if (pIdx >= 0) setPfcIdx(pIdx);
    if (sepIdx >= 0) setSeparatorIdx(sepIdx);
    setResult(null);
  };

  const runIt = () => {
    const r = runAssembly({ compressor, inverter, strategy, load, pfc, separator });
    setResult(r);
    // 归档到历史会话（每次都 push，去重在 store 内部处理）
    pushHistory({
      mode: mode === 'history' ? 'sandbox' : mode,
      challengeId: mode === 'challenge' && challenge ? challenge.id : undefined,
      slotIds: currentSlotIds,
      verdict: r.verdict,
      cop: r.metrics.cop,
      Tdischarge: r.metrics.Tdischarge,
      reachedTarget: r.timeline.reachedTarget,
      faultCount: r.items.filter((i) => i.level === 'fault').length,
      warnCount: r.items.filter((i) => i.level === 'warn').length,
    });
    if (mode === 'challenge' && challenge) {
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      // push 到路径（会话级）
      setAttemptHistory((prev) => [...prev, { slotIds: currentSlotIds, result: r, timestamp: Date.now() }]);
      // Phase C：同步 push 到 persist 的 replay store（跨刷新可回放）
      pushReplayStep(challenge.id, {
        slotIds: currentSlotIds,
        verdict: r.verdict,
        cop: r.metrics.cop,
        requiredIqA: r.metrics.requiredIqA,
        pressureRatio: r.metrics.pressureRatio,
        Tdischarge: r.metrics.Tdischarge,
        summary: locale === 'en-US' ? r.summaryEn : r.summary,
      });
      if (checkChallengePass(challenge, r)) {
        const prevBest = challengeRecords[challenge.id]?.bestAttempts ?? Infinity;
        if (nextAttempts < prevBest) {
          setJustCompleted(true);
        }
        recordPass(challenge.id, nextAttempts);
      }
    }
  };

  // ESC 关闭（仅浮层模式生效）
  useEffect(() => {
    if (!open || embedded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, embedded]);

  if (!isVisible) return null;

  // 内容主体（与 embedded / modal 共用）渲染在下面 inner div 内；
  // modal 模式额外包一层 fixed inset 遮罩 + 居中 + 背景；嵌入模式直接返回 inner。
  const innerClass = embedded
    ? 'relative w-full overflow-hidden rounded-2xl border border-line-subtle bg-bg-surface'
    : 'relative max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-line-subtle bg-bg-surface shadow-xl';

  const content = (
    <div
      className={innerClass}
      onClick={embedded ? undefined : (e) => e.stopPropagation()}
    >
        {/* 顶部条 */}
        <header className="flex items-center justify-between gap-3 border-b border-line-subtle bg-bg-raised px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-caption uppercase tracking-[0.22em] text-ink-muted">Assembly Workshop</p>
            <h2 className="font-display text-title text-ink-primary">{t('assemblyWorkshop.workshopTitle')}</h2>
            <p className="mt-0.5 truncate text-caption text-ink-muted">
              {mode === 'sandbox' ? t('assemblyWorkshop.subtitleSandbox') : t('assemblyWorkshop.subtitleChallenge')}
            </p>
          </div>
          {/* 模式 tab strip */}
          <div role="tablist" aria-label={t('assemblyWorkshop.modeTabsAria')} className="flex shrink-0 rounded-md border border-line-subtle bg-bg-base p-0.5 text-caption">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'sandbox'}
              onClick={() => { setMode('sandbox'); setChallengeId(null); setJustCompleted(false); }}
              className={`rounded px-2.5 py-1 transition-colors ${mode === 'sandbox' ? 'bg-accent-primary/15 text-accent-primary' : 'text-ink-muted hover:text-ink-primary'}`}
            >
              {t('assemblyWorkshop.modeSandbox')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'challenge'}
              onClick={() => { setMode('challenge'); if (!challengeId) loadChallenge(assemblyChallenges[0].id); }}
              className={`rounded px-2.5 py-1 transition-colors ${mode === 'challenge' ? 'bg-accent-measure/15 text-accent-measure' : 'text-ink-muted hover:text-ink-primary'}`}
            >
              {t('assemblyWorkshop.modeChallengeCount').replace('{n}', String(completedChallenges.size)).replace('{m}', String(assemblyChallenges.length))}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'history'}
              onClick={() => setMode('history')}
              className={`rounded px-2.5 py-1 transition-colors ${mode === 'history' ? 'bg-accent-warn/15 text-accent-warn' : 'text-ink-muted hover:text-ink-primary'}`}
            >
              {t('assemblyWorkshop.modeHistoryCount').replace('{n}', String(history.length))}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveSnapshot}
              title={t('assemblyWorkshop.snapshotSaveTitle').replace('{n}', String(snapshots.length))}
              className="flex items-center gap-1.5 rounded-md border border-line-subtle bg-bg-base px-2 py-1.5 text-body text-ink-secondary transition-colors hover:bg-bg-raised hover:text-ink-primary"
            >
              <Save className="h-4 w-4" />
              {t('assemblyWorkshop.saveSnapshot')} {snapshots.length > 0 && <span className="font-mono text-caption text-ink-muted">{snapshots.length}/5</span>}
            </button>
            <button
              type="button"
              onClick={handleExportC}
              title={t('assemblyWorkshop.exportCTitle')}
              className="flex items-center gap-1.5 rounded-md border border-line-subtle bg-bg-base px-2 py-1.5 text-body text-ink-secondary transition-colors hover:bg-bg-raised hover:text-ink-primary"
            >
              <FileCode className="h-4 w-4" />
              {t('assemblyWorkshop.exportC')}
            </button>
            <button
              type="button"
              onClick={runIt}
              className="flex items-center gap-1.5 rounded-md border border-accent-primary/60 bg-accent-primary/15 px-3 py-1.5 text-body text-accent-primary transition-colors hover:bg-accent-primary/25"
            >
              <Play className="h-4 w-4" />
              {t('assemblyWorkshop.runSimulation')}
            </button>
            {!embedded && onClose && (
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={onClose}
                className="rounded-md border border-line-subtle p-1.5 text-ink-muted transition-colors hover:bg-bg-base hover:text-ink-primary"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>

        {/* 主体：history 模式占满，其它模式 = 左拓扑/右诊断 */}
        <div className="max-h-[calc(92vh-72px)] overflow-y-auto">
          {mode === 'history' ? (
            <HistoryPanel
              history={history}
              onApply={handleApplyHistory}
              onClear={clearHistory}
            />
          ) : (
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_360px]">
            {/* 左：（挑战卡 +）拓扑图 + 4 个槽位 */}
            <section className="space-y-3">
              {mode === 'challenge' && challenge && (
                <ChallengeCard
                  challenge={challenge}
                  attempts={attempts}
                  result={result}
                  showHint={showHint}
                  setShowHint={setShowHint}
                  justCompleted={justCompleted}
                  completedChallenges={completedChallenges}
                  challengeRecords={challengeRecords}
                  onPickChallenge={loadChallenge}
                  onExit={exitChallenge}
                  onResetAll={resetAllProgress}
                />
              )}
              <Suspense
                fallback={
                  <div className="flex h-72 items-center justify-center rounded-2xl border border-line-subtle bg-bg-base text-caption text-ink-muted">
                    {t('assemblyWorkshop.schematicLoading')}
                  </div>
                }
              >
                <SystemSchematic
                  compressor={compressor}
                  inverter={inverter}
                  strategy={strategy}
                  load={load}
                  pfc={pfc}
                  separator={separator}
                  refrigerantMismatch={refrigerantMismatch}
                  result={result}
                  onSwapCompressor={(v) => handleSlotChange(setCompressorIdx, v)}
                  onSwapInverter={(v) => handleSlotChange(setInverterIdx, v)}
                  onSwapStrategy={(v) => handleSlotChange(setStrategyIdx, v)}
                  onSwapLoad={(v) => handleSlotChange(setLoadIdx, v)}
                  onSwapPfc={(v) => handleSlotChange(setPfcIdx, v)}
                  onSwapSeparator={(v) => handleSlotChange(setSeparatorIdx, v)}
                />
              </Suspense>

              <div className="grid gap-2 md:grid-cols-2">
                <SlotPicker
                  icon={<Snowflake className="h-4 w-4" />}
                  title={t('assemblyWorkshop.slotCompressor')}
                  current={`${compressor.brand} ${compressor.partNo}`}
                  subtitle={`${compressor.type} · ${compressor.hp}HP · ${compressor.refrigerant}`}
                  options={compressorBundles.map((b, i) => ({ value: i, label: `${b.compressor.brand.split('（')[0]} ${b.compressor.partNo}` }))}
                  value={compressorIdx}
                  onChange={(v) => handleSlotChange(setCompressorIdx, v)}
                  dragCategory="compressor"
                />
                <SlotPicker
                  icon={<CircuitBoard className="h-4 w-4" />}
                  title={t('assemblyWorkshop.slotInverterPlatform')}
                  current={`${inverter.ipmBrand} ${inverter.ipmPartNo}`}
                  subtitle={`${inverter.topology} · ${inverter.ratedCurrentA}A/${inverter.ratedBusV}V · MCU ${inverter.mcuPartNo}`}
                  options={inverterPlatforms.map((p, i) => ({ value: i, label: `${p.ipmBrand} ${p.ipmPartNo}` }))}
                  value={inverterIdx}
                  onChange={(v) => handleSlotChange(setInverterIdx, v)}
                  dragCategory="inverter"
                />
                <SlotPicker
                  icon={<Cpu className="h-4 w-4" />}
                  title={t('assemblyWorkshop.slotStrategy')}
                  current={strategy.name}
                  subtitle={strategy.brief}
                  options={controlStrategies.map((s, i) => ({ value: i, label: s.name }))}
                  value={strategyIdx}
                  onChange={(v) => handleSlotChange(setStrategyIdx, v)}
                  dragCategory="strategy"
                />
                <SlotPicker
                  icon={<Wrench className="h-4 w-4" />}
                  title={t('assemblyWorkshop.slotLoadFull')}
                  current={load.name}
                  subtitle={load.brief}
                  options={loadConditions.map((l, i) => ({ value: i, label: l.name }))}
                  value={loadIdx}
                  onChange={(v) => handleSlotChange(setLoadIdx, v)}
                  dragCategory="load"
                />
                <SlotPicker
                  icon={<Zap className="h-4 w-4" />}
                  title={t('assemblyWorkshop.slotPfcFull')}
                  current={pfc.name}
                  subtitle={pfc.brief}
                  options={pfcPlatforms.map((p, i) => ({ value: i, label: p.name }))}
                  value={pfcIdx}
                  onChange={(v) => handleSlotChange(setPfcIdx, v)}
                  dragCategory="pfc"
                />
                <SlotPicker
                  icon={<Filter className="h-4 w-4" />}
                  title={t('assemblyWorkshop.slotSeparatorFull')}
                  current={separator.name}
                  subtitle={separator.brief}
                  options={liquidSeparators.map((s, i) => ({ value: i, label: s.name }))}
                  value={separatorIdx}
                  onChange={(v) => handleSlotChange(setSeparatorIdx, v)}
                  dragCategory="separator"
                />
              </div>

              {/* 时域仿真时间线：8s 启动 + 稳态 */}
              {result && <TimelineChart timeline={result.timeline} compressor={compressor} />}
            </section>

            {/* 右：诊断面板 + 解题路径 + 快照对比 */}
            <section className="space-y-3">
              <DiagnosticPanel result={result} />
              {mode === 'challenge' && attemptHistory.length > 0 && (
                <SolutionPathPanel history={attemptHistory} />
              )}
              {snapshots.length > 0 && (
                <SnapshotComparePanel
                  snapshots={snapshots}
                  currentSlotIds={currentSlotIds}
                  currentResult={result}
                  onApply={handleApplySnapshot}
                  onDelete={deleteSnapshot}
                />
              )}
            </section>
          </div>
          )}
        </div>
      </div>
  );

  // 嵌入模式直接返回 content；浮层模式包一层 fixed inset 遮罩
  if (embedded) return content;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('assemblyWorkshop.workshopTitle')}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {content}
    </div>
  );
}

// ———————————————————— SlotPicker (chip 行版本 · 支持拖拽到拓扑块) ————————————————————

// drag data type：自定义 MIME，避免和文本拖入冲突
const DRAG_TYPE = 'application/x-assembly-slot';

/**
 * 6 个槽位的"积木库"卡片。
 * - 每个选项渲染为一个可点击 + 可拖拽的 chip
 * - 拖拽时 dataTransfer 写入 `${category}:${index}` —— 拓扑块的 onDrop 按 category 校验
 * - 点击 chip = 切换（保留原有行为，accessibility 友好）
 * - 拖 chip 到对应拓扑块 = 同样切换（搭积木感）
 */
function SlotPicker<T extends number | string>({
  icon, title, current, subtitle, options, value, onChange, dragCategory,
}: {
  icon: React.ReactNode;
  title: string;
  current: string;
  subtitle: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  /** 拖拽 category 标识，与 TopologyDiagram BlockBox 的 acceptCategory 对应 */
  dragCategory: 'compressor' | 'inverter' | 'strategy' | 'load' | 'pfc' | 'separator';
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-line-subtle bg-bg-base p-3">
      <div className="mb-1.5 flex items-center justify-between gap-1.5 text-caption text-ink-muted">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="uppercase tracking-[0.18em]">{title}</span>
        </div>
        <span className="text-[10px] text-ink-muted">{t('assemblyWorkshop.chipCountHint').replace('{n}', String(options.length))}</span>
      </div>
      {/* 横向滚动 chip 行 */}
      <div className="scrollbar-thin flex gap-1 overflow-x-auto pb-1.5" role="listbox" aria-label={t('assemblyWorkshop.slotListboxAria').replace('{title}', title)}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={active}
              draggable
              onDragStart={(e) => {
                const idx = options.findIndex((opt) => opt.value === o.value);
                e.dataTransfer.setData(DRAG_TYPE, `${dragCategory}:${idx}`);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onChange(o.value)}
              title={t('assemblyWorkshop.chipDragTitle').replace('{label}', o.label)}
              className={`shrink-0 cursor-grab rounded border px-2 py-1 text-caption transition-colors active:cursor-grabbing ${
                active
                  ? 'border-accent-primary/60 bg-accent-primary/15 text-accent-primary'
                  : 'border-line-subtle bg-bg-surface text-ink-secondary hover:border-accent-primary/40 hover:bg-accent-primary/5'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 truncate text-caption text-ink-primary" title={current}>{current}</p>
      <p className="mt-0.5 line-clamp-2 text-caption text-ink-secondary">{subtitle}</p>
    </div>
  );
}

// ———————————————————— DiagnosticPanel ————————————————————

function DiagnosticPanel({ result }: { result: AssemblyResult | null }) {
  const { t, locale } = useI18n();
  const verdictTone = useMemo(() => {
    if (!result) return null;
    if (result.verdict === 'fail') return { color: 'text-accent-fault', bg: 'bg-accent-fault/10', border: 'border-accent-fault/60', icon: <AlertTriangle className="h-4 w-4" /> };
    if (result.verdict === 'pass-warn') return { color: 'text-accent-warn', bg: 'bg-accent-warn/10', border: 'border-accent-warn/60', icon: <AlertCircle className="h-4 w-4" /> };
    return { color: 'text-accent-measure', bg: 'bg-accent-measure/10', border: 'border-accent-measure/60', icon: <CheckCircle2 className="h-4 w-4" /> };
  }, [result]);

  if (!result || !verdictTone) {
    return (
      <div className="rounded-xl border border-line-subtle bg-bg-base p-6 text-center text-caption text-ink-muted">
        {t('assemblyWorkshop.diagnoseHint')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 总判定 */}
      <div className={`flex items-center gap-2 rounded-xl border ${verdictTone.border} ${verdictTone.bg} px-3 py-2 ${verdictTone.color}`}>
        {verdictTone.icon}
        <div className="flex-1">
          <p className="text-body font-medium">{result.verdict === 'pass' ? t('assemblyWorkshop.verdictPass') : result.verdict === 'pass-warn' ? t('assemblyWorkshop.verdictPassWarn') : t('assemblyWorkshop.verdictFail')}</p>
          <p className="text-caption opacity-90">{locale === 'en-US' ? result.summaryEn : result.summary}</p>
        </div>
      </div>

      {/* KPI 网格 */}
      <div className="rounded-xl border border-line-subtle bg-bg-base p-3">
        <p className="mb-2 text-caption uppercase tracking-[0.18em] text-ink-muted">{t('assemblyWorkshop.steadyMetrics')}</p>
        <div className="grid grid-cols-2 gap-2 text-caption">
          <Kpi label={t('assemblyWorkshop.kpiCooling')} value={`${(result.metrics.coolingW / 1000).toFixed(2)} kW`} tone="measure" />
          <Kpi label={t('assemblyWorkshop.kpiInputPower')} value={`${(result.metrics.inputW / 1000).toFixed(2)} kW`} tone="warn" />
          <Kpi label="COP" value={result.metrics.cop.toFixed(2)} tone={result.metrics.cop > 3.5 ? 'measure' : result.metrics.cop > 2.5 ? 'warn' : 'fault'} />
          <Kpi label={t('assemblyWorkshop.kpiDischargeTemp')} value={`${result.metrics.Tdischarge.toFixed(1)} °C`} tone={result.metrics.Tdischarge > 90 ? 'fault' : result.metrics.Tdischarge > 80 ? 'warn' : 'measure'} />
          <Kpi label={t('assemblyWorkshop.kpiPressureRatio')} value={result.metrics.pressureRatio.toFixed(2)} />
          <Kpi label={t('assemblyWorkshop.kpiTargetRpm')} value={`${result.metrics.targetRpm} rpm`} />
          <Kpi label={t('assemblyWorkshop.kpiSteadyIq')} value={`${result.metrics.requiredIqA.toFixed(2)} A`} />
          <Kpi label={t('assemblyWorkshop.kpiBusHeadroom')} value={`${result.metrics.busHeadroomPct.toFixed(0)}%`} tone={result.metrics.busHeadroomPct < 5 ? 'fault' : result.metrics.busHeadroomPct < 15 ? 'warn' : 'measure'} />
        </div>
      </div>

      {/* 诊断条目 */}
      <div className="rounded-xl border border-line-subtle bg-bg-base p-3">
        <p className="mb-2 text-caption uppercase tracking-[0.18em] text-ink-muted">{t('assemblyWorkshop.diagnosticListCount').replace('{n}', String(result.items.length))}</p>
        <ul className="space-y-1.5">
          {result.items.map((item, i) => (
            <DiagnosticRow key={i} item={item} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'measure' | 'warn' | 'fault' }) {
  const cls = tone === 'measure' ? 'text-accent-measure' : tone === 'warn' ? 'text-accent-warn' : tone === 'fault' ? 'text-accent-fault' : 'text-ink-primary';
  return (
    <div className="rounded-md border border-line-subtle bg-bg-surface px-2 py-1.5">
      <div className="text-[10px] uppercase text-ink-muted">{label}</div>
      <div className={`font-mono text-body font-medium ${cls}`}>{value}</div>
    </div>
  );
}

function DiagnosticRow({
  item,
}: {
  item: { level: 'ok' | 'warn' | 'fault'; message: string; messageEn?: string; hintModule?: string };
}) {
  const { t, locale } = useI18n();
  const Icon = item.level === 'ok' ? CheckCircle2 : item.level === 'warn' ? AlertCircle : AlertTriangle;
  const cls = item.level === 'ok' ? 'text-accent-measure' : item.level === 'warn' ? 'text-accent-warn' : 'text-accent-fault';
  const message = locale === 'en-US' ? (item.messageEn ?? item.message) : item.message;
  return (
    <li className="flex items-start gap-2 text-caption leading-relaxed">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${cls}`} />
      <div className="min-w-0">
        <p className="text-ink-secondary">{message}</p>
        {item.hintModule && <p className="mt-0.5 text-[10px] text-ink-muted">{t('assemblyWorkshop.reviewModulePrefix')}{item.hintModule}{t('assemblyWorkshop.reviewModuleSuffix')}</p>}
      </div>
    </li>
  );
}

// ———————————————————— TimelineChart ————————————————————

const STATE_COLORS: Record<string, string> = {
  align: '#9eb5cb',       // 灰
  openloop: '#ffb84d',    // 警告色（开环 = 还没闭上）
  hfi: '#34d6ff',         // primary（HFI 注入）
  bemf: '#43f7b5',        // measure（闭环 + 有反馈）
  fieldweak: '#a78bfa',   // 紫（弱磁段特殊）
  steady: '#43f7b5',
};

function TimelineChart({ timeline, compressor }: { timeline: AssemblyTimeline; compressor: CompressorSpec }) {
  const { t } = useI18n();
  // 本地游标：用 store.time 但 4 秒一周期把 0..1 映射到 0..8s
  const time = useSimulationStore((s) => s.time);
  const running = useSimulationStore((s) => s.running);
  const cursorSec = running ? (time % 8) : 8;  // 暂停时停在最右端，运行时滚动

  // 找 cursor 处的样本
  const curIdx = Math.min(timeline.samples.length - 1, Math.max(0, Math.floor(cursorSec / 0.02)));
  const cur = timeline.samples[curIdx];

  return (
    <div className="rounded-xl border border-line-subtle bg-bg-base p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-accent-primary" />
          <p className="text-caption uppercase tracking-[0.18em] text-ink-muted">{t('assemblyWorkshop.timelineTitle')}</p>
        </div>
        <div className="flex gap-1 text-[10px]">
          {timeline.transitions.map((tr, i) => (
            <span
              key={i}
              className="rounded border px-1 py-0.5"
              style={{ color: STATE_COLORS[tr.state], borderColor: STATE_COLORS[tr.state] + '50' }}
              title={`${tr.t.toFixed(2)}s · ${tr.label}`}
            >
              {tr.label}
            </span>
          ))}
        </div>
      </div>

      <div className="h-44">
        <SafeResponsiveContainer>
          <LineChart data={timeline.samples} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="rgba(231,243,255,0.06)" strokeDasharray="3 6" />
            <XAxis dataKey="t" tick={{ fill: '#9eb5cb', fontSize: 10 }} domain={[0, 8]} type="number" tickCount={9} unit="s" />
            <YAxis yAxisId="rpm" tick={{ fill: '#9eb5cb', fontSize: 10 }} domain={[0, 'dataMax']} />
            <YAxis yAxisId="iq" orientation="right" tick={{ fill: '#9eb5cb', fontSize: 10 }} domain={[0, compressor.ratedCurrentA * 1.5]} hide />
            <Tooltip
              contentStyle={{ background: '#0d1929', border: '1px solid #1e2a3d', borderRadius: 8, color: '#e7f3ff', fontSize: 11 }}
              formatter={(v, name) => {
                const num = Number(v ?? 0);
                const label = name === 'rpm' ? t('assemblyWorkshop.legendActualRpm') : name === 'rpmRef' ? t('assemblyWorkshop.legendTarget') : name === 'iqA' ? 'Iq' : t('assemblyWorkshop.legendBusUtil');
                const display = name === 'rpm' || name === 'rpmRef' ? `${num.toFixed(0)} rpm` : name === 'iqA' ? `${num.toFixed(2)} A` : `${(num * 100).toFixed(0)}%`;
                return [display, label];
              }}
              labelFormatter={(t) => `t = ${Number(t).toFixed(2)} s`}
            />
            <Line yAxisId="rpm" type="monotone" dataKey="rpmRef" dot={false} stroke="#9eb5cb" strokeWidth={1} strokeDasharray="4 4" isAnimationActive={false} />
            <Line yAxisId="rpm" type="monotone" dataKey="rpm" dot={false} stroke="#43f7b5" strokeWidth={1.8} isAnimationActive={false} />
            <Line yAxisId="iq" type="monotone" dataKey="iqA" dot={false} stroke="#34d6ff" strokeWidth={1.3} isAnimationActive={false} />
            <ReferenceLine yAxisId="iq" y={compressor.ratedCurrentA} stroke="#ffb84d" strokeWidth={0.8} strokeDasharray="2 4" label={{ value: t('assemblyWorkshop.ratedIq'), fill: '#ffb84d', fontSize: 10, position: 'right' }} />
            {/* 状态切换标线 */}
            {timeline.transitions.slice(1).map((tr, i) => (
              <ReferenceLine
                key={i}
                yAxisId="rpm"
                x={tr.t}
                stroke={STATE_COLORS[tr.state] + '60'}
                strokeWidth={1}
              />
            ))}
            {/* 游标线 + 当前样本点 */}
            <ReferenceLine yAxisId="rpm" x={cursorSec} stroke="#e7f3ff" strokeWidth={1.5} />
            {cur && <ReferenceDot yAxisId="rpm" x={cur.t} y={cur.rpm} r={3} fill="#43f7b5" stroke="#07111f" strokeWidth={1.5} />}
          </LineChart>
        </SafeResponsiveContainer>
      </div>

      {/* 游标读数 */}
      <div className="mt-2 grid grid-cols-2 gap-2 text-caption sm:grid-cols-4">
        <Kpi label={t('assemblyWorkshop.cursorTime')} value={`${cursorSec.toFixed(2)} s`} />
        <Kpi label={t('assemblyWorkshop.cursorState')} value={cur?.state ?? '-'} tone={cur?.faultActive ? 'fault' : 'measure'} />
        <Kpi label={t('assemblyWorkshop.cursorRpm')} value={`${(cur?.rpm ?? 0).toFixed(0)} rpm`} />
        <Kpi label="Iq" value={`${(cur?.iqA ?? 0).toFixed(2)} A`} tone={(cur?.iqA ?? 0) > compressor.ratedCurrentA ? 'fault' : 'measure'} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-caption">
        <Kpi label={t('assemblyWorkshop.rise50')} value={timeline.rise50PctS === Infinity ? t('assemblyWorkshop.notReached') : `${timeline.rise50PctS.toFixed(2)} s`} />
        <Kpi label={t('assemblyWorkshop.settling95')} value={timeline.settling95PctS === Infinity ? t('assemblyWorkshop.notReached') : `${timeline.settling95PctS.toFixed(2)} s`} tone={timeline.settling95PctS > 5 ? 'warn' : 'measure'} />
        <Kpi label={t('assemblyWorkshop.targetReached')} value={timeline.reachedTarget ? t('assemblyWorkshop.reachedMark') : t('assemblyWorkshop.notReachedMark')} tone={timeline.reachedTarget ? 'measure' : 'fault'} />
      </div>
    </div>
  );
}

// ———————————————————— ChallengeCard ————————————————————

function ChallengeCard({
  challenge, attempts, result, showHint, setShowHint, justCompleted, completedChallenges, challengeRecords, onPickChallenge, onExit, onResetAll,
}: {
  challenge: AssemblyChallenge;
  attempts: number;
  result: AssemblyResult | null;
  showHint: boolean;
  setShowHint: (v: boolean) => void;
  justCompleted: boolean;
  completedChallenges: Set<string>;
  challengeRecords: Record<string, { bestAttempts: number; firstPassedAt: number }>;
  onPickChallenge: (id: string) => void;
  onExit: () => void;
  onResetAll: () => void;
}) {
  const { t } = useI18n();
  const progress = challengeProgress(challenge, result);
  const passed = completedChallenges.has(challenge.id);
  const bestAttempts = challengeRecords[challenge.id]?.bestAttempts;
  const levelLabel = `Lv.${challenge.level}`;
  const levelColor = challenge.level === 1 ? 'text-accent-measure' : challenge.level === 2 ? 'text-accent-primary' : challenge.level === 3 ? 'text-accent-warn' : 'text-accent-fault';

  return (
    <div className={`rounded-xl border p-3 ${justCompleted ? 'border-accent-measure/60 bg-accent-measure/10' : passed ? 'border-accent-measure/40 bg-accent-measure/5' : 'border-accent-primary/40 bg-accent-primary/5'}`}>
      {/* 标题行 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-caption">
            <Target className="h-3.5 w-3.5 text-accent-primary" />
            <span className="uppercase tracking-[0.18em] text-ink-muted">{t('assemblyWorkshop.challengeLabel')}</span>
            <span className={`font-mono ${levelColor}`}>{levelLabel}</span>
            {passed && (
              <span className="flex items-center gap-0.5 text-accent-measure" title={t('assemblyWorkshop.bestPassTitle').replace('{n}', String(bestAttempts))}>
                <Trophy className="h-3.5 w-3.5" />
                <span className="font-mono">{bestAttempts}</span>
              </span>
            )}
          </div>
          <h3 className="mt-0.5 font-display text-body font-medium text-ink-primary">{challenge.title}</h3>
        </div>
        {/* 题目选择 */}
        <div className="relative shrink-0">
          <select
            value={challenge.id}
            onChange={(e) => onPickChallenge(e.target.value)}
            aria-label={t('assemblyWorkshop.pickChallengeAria')}
            className="appearance-none rounded-md border border-line-subtle bg-bg-surface px-2 py-1 pr-7 text-caption text-ink-primary focus:border-accent-primary focus:outline-none"
          >
            {assemblyChallenges.map((c) => {
              const rec = challengeRecords[c.id];
              const prefix = rec ? t('assemblyWorkshop.optionSolvedPrefix').replace('{n}', String(rec.bestAttempts)) : '';
              return (
                <option key={c.id} value={c.id}>{prefix}Lv.{c.level} · {c.title}</option>
              );
            })}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        </div>
      </div>

      <p className="mt-2 text-caption leading-relaxed text-ink-secondary">{challenge.brief}</p>
      <p className="mt-1 text-caption leading-relaxed text-ink-primary">
        <span className="font-medium">{t('assemblyWorkshop.goalLabel')}</span>{challenge.goal}
      </p>

      {/* 进度条 */}
      <div className="mt-2 flex items-center gap-2 text-caption">
        <span className="text-ink-muted">{t('assemblyWorkshop.requiredIssues')}</span>
        <div className="flex-1 overflow-hidden rounded-full border border-line-subtle bg-bg-base">
          <div
            className="h-2 bg-accent-measure transition-all duration-300"
            style={{ width: `${(progress.resolved / progress.total) * 100}%` }}
            role="progressbar"
            aria-valuenow={progress.resolved}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label={t('assemblyWorkshop.progressAria').replace('{n}', String(progress.resolved)).replace('{m}', String(progress.total))}
          />
        </div>
        <span className="font-mono text-ink-primary">{progress.resolved}/{progress.total}</span>
        <span className="text-ink-muted">{t('assemblyWorkshop.currentAttempts').replace('{n}', String(attempts))}</span>
      </div>

      {/* 提示按钮 + 提示文 */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-caption">
        <button
          type="button"
          onClick={() => setShowHint(!showHint)}
          className="flex items-center gap-1 rounded border border-line-subtle bg-bg-base px-2 py-0.5 text-ink-muted transition-colors hover:bg-bg-raised hover:text-ink-primary"
        >
          <Lightbulb className="h-3 w-3" />
          {showHint ? t('assemblyWorkshop.hideHint') : t('assemblyWorkshop.showHint')}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="rounded border border-line-subtle bg-bg-base px-2 py-0.5 text-ink-muted transition-colors hover:bg-bg-raised hover:text-ink-primary"
        >
          {t('assemblyWorkshop.backToSandbox')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('assemblyWorkshop.resetRecordsConfirm'))) onResetAll();
          }}
          className="rounded border border-line-subtle bg-bg-base px-2 py-0.5 text-ink-muted transition-colors hover:bg-accent-fault/10 hover:text-accent-fault"
        >
          {t('assemblyWorkshop.resetRecords')}
        </button>
      </div>
      {showHint && (
        <p className="mt-1.5 rounded-lg border border-accent-warn/40 bg-accent-warn/5 p-2 text-caption leading-relaxed text-accent-warn">
          <Lightbulb className="mr-1 inline h-3 w-3" />{challenge.hint}
        </p>
      )}

      {/* 通关庆祝（首通 / 刷新最佳都触发） */}
      {justCompleted && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-accent-measure/60 bg-accent-measure/10 px-2 py-1.5 text-caption text-accent-measure">
          <Sparkles className="h-4 w-4" />
          <span>
            <strong>{t('assemblyWorkshop.challengeClearedLead')}</strong>{t('assemblyWorkshop.challengeClearedBody').replace('{n}', String(attempts))}
          </span>
        </div>
      )}
    </div>
  );
}

// ———————————————————— SnapshotComparePanel ————————————————————

const VERDICT_LABEL: Record<'pass' | 'pass-warn' | 'fail', TKey> = { pass: 'assemblyWorkshop.verdictPass', 'pass-warn': 'assemblyWorkshop.verdictPassWarnShort', fail: 'assemblyWorkshop.verdictFail' };
const VERDICT_TONE = { pass: 'measure', 'pass-warn': 'warn', fail: 'fault' } as const;

function SnapshotComparePanel({
  snapshots, currentSlotIds, currentResult, onApply, onDelete,
}: {
  snapshots: AssemblySnapshot[];
  currentSlotIds: AssemblySnapshot['slotIds'];
  currentResult: AssemblyResult | null;
  onApply: (snap: AssemblySnapshot) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  // 每个 snapshot 按其 slotIds 实时跑一次 runAssembly，得到对比数据
  const snapshotResults = useMemo(() => snapshots.map((snap) => {
    const c = compressorBundles.find((b) => b.id === snap.slotIds.compressorBundleId)?.compressor;
    const i = inverterPlatforms.find((p) => p.ipmPartNo === snap.slotIds.inverterPartNo);
    const s = controlStrategies.find((s) => s.id === snap.slotIds.strategyId);
    const l = loadConditions.find((l) => l.id === snap.slotIds.loadId);
    const p = pfcPlatforms.find((p) => p.id === snap.slotIds.pfcId);
    const sep = liquidSeparators.find((s) => s.id === snap.slotIds.separatorId);
    if (!c || !i || !s || !l || !p || !sep) return { snap, result: null as AssemblyResult | null };
    return { snap, result: runAssembly({ compressor: c, inverter: i, strategy: s, load: l, pfc: p, separator: sep }) };
  }), [snapshots]);

  const isCurrent = (snap: AssemblySnapshot) =>
    snap.slotIds.compressorBundleId === currentSlotIds.compressorBundleId
    && snap.slotIds.inverterPartNo === currentSlotIds.inverterPartNo
    && snap.slotIds.strategyId === currentSlotIds.strategyId
    && snap.slotIds.loadId === currentSlotIds.loadId
    && snap.slotIds.pfcId === currentSlotIds.pfcId
    && snap.slotIds.separatorId === currentSlotIds.separatorId;

  return (
    <div className="rounded-xl border border-line-subtle bg-bg-base p-3">
      <p className="mb-2 text-caption uppercase tracking-[0.18em] text-ink-muted">{t('assemblyWorkshop.snapshotCompareCount').replace('{n}', String(snapshots.length))}</p>
      <div className="space-y-2">
        {snapshotResults.map(({ snap, result }) => (
          <SnapshotRow
            key={snap.id}
            snap={snap}
            result={result}
            currentResult={currentResult}
            current={isCurrent(snap)}
            onApply={() => onApply(snap)}
            onDelete={() => onDelete(snap.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SnapshotRow({
  snap, result, currentResult, current, onApply, onDelete,
}: {
  snap: AssemblySnapshot;
  result: AssemblyResult | null;
  currentResult: AssemblyResult | null;
  current: boolean;
  onApply: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  if (!result) {
    return (
      <div className="rounded-lg border border-accent-fault/40 bg-accent-fault/5 p-2 text-caption text-accent-fault">
        {t('assemblyWorkshop.snapshotMissing').replace('{name}', snap.name)}
        <button type="button" onClick={onDelete} className="float-right text-ink-muted hover:text-accent-fault">{t('assemblyWorkshop.deleteAction')}</button>
      </div>
    );
  }
  const tone = VERDICT_TONE[result.verdict];
  const toneCls = tone === 'measure' ? 'border-accent-measure/40 bg-accent-measure/5'
    : tone === 'warn' ? 'border-accent-warn/40 bg-accent-warn/5'
    : 'border-accent-fault/40 bg-accent-fault/5';
  const verdictTextCls = tone === 'measure' ? 'text-accent-measure' : tone === 'warn' ? 'text-accent-warn' : 'text-accent-fault';

  // 计算与当前的 diff（current 是 null 或 same 时不显示 diff）
  const diff = currentResult && !current
    ? {
        cop: result.metrics.cop - currentResult.metrics.cop,
        Td: result.metrics.Tdischarge - currentResult.metrics.Tdischarge,
        iq: result.metrics.requiredIqA - currentResult.metrics.requiredIqA,
        reached: result.timeline.reachedTarget !== currentResult.timeline.reachedTarget,
      }
    : null;

  return (
    <div className={`rounded-lg border p-2 ${current ? 'border-accent-primary/60 bg-accent-primary/10' : toneCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-caption">
            {current && <span className="rounded border border-accent-primary/60 px-1 text-[10px] text-accent-primary">{t('assemblyWorkshop.currentBadge')}</span>}
            <span className={`font-mono text-[10px] ${verdictTextCls}`}>{t(VERDICT_LABEL[result.verdict])}</span>
            <span className="truncate text-ink-primary" title={snap.name}>{snap.name}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {!current && (
            <button
              type="button"
              onClick={onApply}
              title={t('assemblyWorkshop.applySnapshotTitle')}
              className="rounded border border-line-subtle bg-bg-surface p-1 text-ink-muted transition-colors hover:bg-accent-primary/10 hover:text-accent-primary"
            >
              <ArrowRightCircle className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            title={t('assemblyWorkshop.deleteSnapshotTitle')}
            className="rounded border border-line-subtle bg-bg-surface p-1 text-ink-muted transition-colors hover:bg-accent-fault/10 hover:text-accent-fault"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1 text-[10px]">
        <MiniKpi label="COP" value={result.metrics.cop.toFixed(2)} delta={diff?.cop} positiveBetter />
        <MiniKpi label="T_d" value={`${result.metrics.Tdischarge.toFixed(0)}°C`} delta={diff?.Td} positiveBetter={false} />
        <MiniKpi label="Iq" value={`${result.metrics.requiredIqA.toFixed(1)}A`} delta={diff?.iq} positiveBetter={false} />
        <MiniKpi label={t('assemblyWorkshop.onTargetLabel')} value={result.timeline.reachedTarget ? '✓' : '×'} tone={result.timeline.reachedTarget ? 'measure' : 'fault'} />
      </div>
    </div>
  );
}

// ———————————————————— SolutionPathPanel ————————————————————

const SLOT_LABEL_MAP: Record<keyof AssemblySnapshot['slotIds'], TKey> = {
  compressorBundleId: 'assemblyWorkshop.slotCompressor',
  inverterPartNo: 'assemblyWorkshop.slotInverter',
  strategyId: 'assemblyWorkshop.slotStrategy',
  loadId: 'assemblyWorkshop.slotLoad',
  pfcId: 'assemblyWorkshop.slotPfc',
  separatorId: 'assemblyWorkshop.slotSeparator',
};

function slotsDiff(prev: AssemblySnapshot['slotIds'], next: AssemblySnapshot['slotIds']): Array<{ key: string; label: TKey; from: string; to: string }> {
  const changes: Array<{ key: string; label: TKey; from: string; to: string }> = [];
  const keys = Object.keys(SLOT_LABEL_MAP) as Array<keyof AssemblySnapshot['slotIds']>;
  for (const k of keys) {
    if (prev[k] !== next[k]) {
      changes.push({ key: k, label: SLOT_LABEL_MAP[k], from: prev[k], to: next[k] });
    }
  }
  return changes;
}

function shortName(key: string, id: string): string {
  // 各槽位的 ID 缩成短名（与下拉显示一致）
  if (key === 'compressorBundleId') return compressorBundles.find((b) => b.id === id)?.compressor.partNo ?? id;
  if (key === 'inverterPartNo') return id;
  if (key === 'strategyId') return controlStrategies.find((s) => s.id === id)?.name ?? id;
  if (key === 'loadId') return loadConditions.find((l) => l.id === id)?.name ?? id;
  if (key === 'pfcId') return pfcPlatforms.find((p) => p.id === id)?.name ?? id;
  if (key === 'separatorId') return liquidSeparators.find((s) => s.id === id)?.name ?? id;
  return id;
}

function countFaults(result: AssemblyResult): number {
  return result.items.filter((i) => i.level === 'fault').length;
}

function SolutionPathPanel({ history }: { history: Array<{ slotIds: AssemblySnapshot['slotIds']; result: AssemblyResult; timestamp: number }> }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-line-subtle bg-bg-base p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <History className="h-3.5 w-3.5 text-accent-primary" />
        <p className="text-caption uppercase tracking-[0.18em] text-ink-muted">{t('assemblyWorkshop.solutionPathCount').replace('{n}', String(history.length))}</p>
      </div>
      <ol className="space-y-1.5 text-caption">
        {history.map((entry, i) => {
          const prev = i > 0 ? history[i - 1] : null;
          const changes = prev ? slotsDiff(prev.slotIds, entry.slotIds) : [];
          const prevFaults = prev ? countFaults(prev.result) : countFaults(entry.result);
          const curFaults = countFaults(entry.result);
          const faultDelta = curFaults - prevFaults;
          const verdictTone = entry.result.verdict === 'pass' ? 'text-accent-measure'
            : entry.result.verdict === 'pass-warn' ? 'text-accent-warn'
            : 'text-accent-fault';
          const arrow = faultDelta < 0 ? <ArrowDown className="h-3 w-3 text-accent-measure" aria-label={t('assemblyWorkshop.faultDownAria')} />
            : faultDelta > 0 ? <ArrowUp className="h-3 w-3 text-accent-fault" aria-label={t('assemblyWorkshop.faultUpAria')} />
            : <Minus className="h-3 w-3 text-ink-muted" aria-label={t('assemblyWorkshop.faultFlatAria')} />;
          return (
            <li key={i} className="flex items-start gap-2 rounded border border-line-subtle bg-bg-surface p-1.5">
              <span className="mt-0.5 inline-grid h-5 w-5 shrink-0 place-items-center rounded border border-line-subtle text-[10px] font-mono text-ink-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                {i === 0 && <p className="text-ink-muted">{t('assemblyWorkshop.initialConfig')}</p>}
                {i > 0 && changes.length === 0 && <p className="text-ink-muted">{t('assemblyWorkshop.rerunOnly')}</p>}
                {i > 0 && changes.length > 0 && (
                  <p className="text-ink-secondary">
                    {changes.map((c, j) => (
                      <span key={c.key}>
                        {j > 0 && <span className="text-ink-muted"> · </span>}
                        <span className="text-ink-muted">{t(c.label)}:</span>{' '}
                        <span className="line-through text-ink-muted">{shortName(c.key, c.from)}</span>
                        {' → '}
                        <span className="text-accent-primary">{shortName(c.key, c.to)}</span>
                      </span>
                    ))}
                  </p>
                )}
                <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                  <span className={`font-medium ${verdictTone}`}>
                    {entry.result.verdict === 'pass' ? t('assemblyWorkshop.verdictPass') : entry.result.verdict === 'pass-warn' ? t('assemblyWorkshop.verdictPassWarnShort') : t('assemblyWorkshop.verdictFail')}
                  </span>
                  <span className="text-ink-muted">fault</span>
                  <span className="font-mono text-ink-primary">{curFaults}</span>
                  {prev && (
                    <>
                      {arrow}
                      {faultDelta !== 0 && <span className="font-mono text-[10px] text-ink-muted">({faultDelta > 0 ? '+' : ''}{faultDelta})</span>}
                    </>
                  )}
                  <span className="ml-auto text-ink-muted">COP {entry.result.metrics.cop.toFixed(2)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ———————————————————— HistoryPanel ————————————————————

function relativeTime(t: (key: TKey) => string, timestamp: number): string {
  const dMs = Date.now() - timestamp;
  const m = Math.floor(dMs / 60_000);
  if (m < 1) return t('assemblyWorkshop.timeJustNow');
  if (m < 60) return t('assemblyWorkshop.timeMinutesAgo').replace('{n}', String(m));
  const h = Math.floor(m / 60);
  if (h < 24) return t('assemblyWorkshop.timeHoursAgo').replace('{n}', String(h));
  const days = Math.floor(h / 24);
  return t('assemblyWorkshop.timeDaysAgo').replace('{n}', String(days));
}

function HistoryPanel({
  history, onApply, onClear,
}: {
  history: AssemblyHistoryEntry[];
  onApply: (entry: AssemblyHistoryEntry) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  // 多选对比：最多选 2 条
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      }
      return next;
    });
  };

  if (history.length === 0) {
    return (
      <div className="p-8 text-center text-caption text-ink-muted">
        <History className="mx-auto mb-2 h-8 w-8 text-ink-muted" />
        <p>{t('assemblyWorkshop.historyEmpty')}</p>
        <p className="mt-1">{t('assemblyWorkshop.historyEmptyHint')}</p>
      </div>
    );
  }
  // 最新的在最上面
  const reversed = [...history].reverse();
  // 取出选中的两条供对比；按时间先后排（先发生的为 A，后发生的为 B）
  const selectedEntries = history.filter((e) => selectedIds.has(e.id));
  const showCompare = selectedEntries.length === 2;
  const [aEntry, bEntry] = selectedEntries; // history 本身已按时间正序，所以 a 早 b 晚

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-display text-body text-ink-primary">{t('assemblyWorkshop.historyArchiveTitle')}</h3>
          <p className="mt-0.5 text-caption text-ink-muted">
            {t('assemblyWorkshop.historyArchiveHint')}
            <span className="ml-2">{t('assemblyWorkshop.historyCompareHint')}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded border border-line-subtle bg-bg-base px-2 py-1 text-caption text-ink-muted transition-colors hover:bg-bg-raised hover:text-ink-primary"
            >
              {t('assemblyWorkshop.clearSelection').replace('{n}', String(selectedIds.size))}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('assemblyWorkshop.clearHistoryConfirm'))) onClear();
            }}
            className="rounded border border-line-subtle bg-bg-base px-2 py-1 text-caption text-ink-muted transition-colors hover:bg-accent-fault/10 hover:text-accent-fault"
          >
            {t('assemblyWorkshop.clearHistory')}
          </button>
        </div>
      </div>

      {showCompare && <CompareTwoHistory a={aEntry} b={bEntry} />}

      <ol className="space-y-1.5">
        {reversed.map((entry) => (
          <HistoryRow
            key={entry.id}
            entry={entry}
            onApply={() => onApply(entry)}
            selected={selectedIds.has(entry.id)}
            disabledForSelect={selectedIds.size >= 2 && !selectedIds.has(entry.id)}
            onToggleSelect={() => toggle(entry.id)}
          />
        ))}
      </ol>
    </div>
  );
}

// ———————————————————— CompareTwoHistory ————————————————————

function CompareTwoHistory({ a, b }: { a: AssemblyHistoryEntry; b: AssemblyHistoryEntry }) {
  const { t } = useI18n();
  const diff = slotsDiff(a.slotIds, b.slotIds);
  const Δcop = b.cop - a.cop;
  const ΔTd = b.Tdischarge - a.Tdischarge;
  const Δfault = b.faultCount - a.faultCount;
  const Δwarn = b.warnCount - a.warnCount;
  const verdictChanged = a.verdict !== b.verdict;

  return (
    <div className="mb-3 rounded-xl border border-accent-warn/60 bg-accent-warn/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-caption">
        <Activity className="h-3.5 w-3.5 text-accent-warn" />
        <p className="uppercase tracking-[0.18em] text-ink-muted">{t('assemblyWorkshop.compareTitle')}</p>
        <span className="text-ink-muted">{relativeTime(t, a.timestamp)} → {relativeTime(t, b.timestamp)}</span>
      </div>

      {/* slot 差异列表 */}
      <div className="mb-2 space-y-0.5 text-caption">
        <p className="text-ink-muted">
          {diff.length === 0 ? t('assemblyWorkshop.compareIdentical') : t('assemblyWorkshop.compareChangedCount').replace('{n}', String(diff.length))}
        </p>
        {diff.map((d) => (
          <p key={d.key} className="text-ink-secondary">
            <span className="text-ink-muted">{t(d.label)}:</span>{' '}
            <span className="text-accent-warn">{shortName(d.key, d.from)}</span>
            {' → '}
            <span className="text-accent-primary">{shortName(d.key, d.to)}</span>
          </p>
        ))}
      </div>

      {/* KPI delta */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-5">
        <div className="rounded border border-line-subtle bg-bg-surface px-1.5 py-1">
          <div className="text-ink-muted">verdict</div>
          <div className={`font-mono font-medium ${verdictColor(a.verdict)}`}>
            {verdictShort(a.verdict)} → <span className={verdictColor(b.verdict)}>{verdictShort(b.verdict)}</span>
          </div>
          {verdictChanged && <div className="font-mono text-ink-muted">{t('assemblyWorkshop.verdictChanged')}</div>}
        </div>
        <MiniKpi label="COP" value={`${a.cop.toFixed(2)} → ${b.cop.toFixed(2)}`} delta={Δcop} positiveBetter />
        <MiniKpi label="T_d" value={`${a.Tdischarge.toFixed(0)} → ${b.Tdischarge.toFixed(0)}°C`} delta={ΔTd} positiveBetter={false} />
        <MiniKpi label="fault" value={`${a.faultCount} → ${b.faultCount}`} delta={Δfault} positiveBetter={false} />
        <MiniKpi label="warn" value={`${a.warnCount} → ${b.warnCount}`} delta={Δwarn} positiveBetter={false} />
      </div>
    </div>
  );
}

function verdictShort(v: 'pass' | 'pass-warn' | 'fail'): string {
  return v === 'pass' ? '✓' : v === 'pass-warn' ? '⚠' : '✗';
}
function verdictColor(v: 'pass' | 'pass-warn' | 'fail'): string {
  return v === 'pass' ? 'text-accent-measure' : v === 'pass-warn' ? 'text-accent-warn' : 'text-accent-fault';
}

function HistoryRow({
  entry, onApply, selected, disabledForSelect, onToggleSelect,
}: {
  entry: AssemblyHistoryEntry;
  onApply: () => void;
  selected: boolean;
  disabledForSelect: boolean;
  onToggleSelect: () => void;
}) {
  const { t } = useI18n();
  const verdictCls = entry.verdict === 'pass' ? 'text-accent-measure'
    : entry.verdict === 'pass-warn' ? 'text-accent-warn'
    : 'text-accent-fault';
  // selected 时盖一层 primary 边框；否则按 verdict 着色
  const borderCls = selected
    ? 'border-accent-primary/60 bg-accent-primary/10'
    : entry.verdict === 'pass' ? 'border-accent-measure/40 bg-accent-measure/5'
    : entry.verdict === 'pass-warn' ? 'border-accent-warn/40 bg-accent-warn/5'
    : 'border-accent-fault/40 bg-accent-fault/5';
  const compressor = compressorBundles.find((b) => b.id === entry.slotIds.compressorBundleId)?.compressor;
  const strategy = controlStrategies.find((s) => s.id === entry.slotIds.strategyId);
  const loadInfo = loadConditions.find((l) => l.id === entry.slotIds.loadId);
  const pfc = pfcPlatforms.find((p) => p.id === entry.slotIds.pfcId);

  return (
    <li className={`rounded-lg border p-2 ${borderCls}`}>
      <div className="flex items-start gap-2">
        {/* 多选 checkbox */}
        <label className={`mt-1 flex shrink-0 cursor-pointer items-center ${disabledForSelect ? 'cursor-not-allowed opacity-30' : ''}`}>
          <input
            type="checkbox"
            checked={selected}
            disabled={disabledForSelect}
            onChange={onToggleSelect}
            aria-label={t('assemblyWorkshop.selectForCompareAria')}
            className="h-3.5 w-3.5 accent-accent-primary"
          />
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-caption">
            <span className={`font-mono text-[10px] ${verdictCls}`}>
              {entry.verdict === 'pass' ? '✓ ' : entry.verdict === 'pass-warn' ? '⚠ ' : '✗ '}{t(VERDICT_LABEL[entry.verdict])}
            </span>
            {entry.mode === 'challenge' && entry.challengeId && (
              <span className="rounded border border-accent-measure/40 bg-accent-measure/10 px-1 text-[10px] text-accent-measure">
                {t('assemblyWorkshop.challengeLabel')} · {assemblyChallenges.find((c) => c.id === entry.challengeId)?.title.slice(0, 16) ?? entry.challengeId}
              </span>
            )}
            <span className="text-ink-muted">{relativeTime(t, entry.timestamp)}</span>
          </div>
          <p className="mt-0.5 truncate text-caption text-ink-primary">
            {compressor?.brand} {compressor?.partNo} · {strategy?.name} · {loadInfo?.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-ink-muted">
            <span>COP <span className="font-mono text-ink-primary">{entry.cop.toFixed(2)}</span></span>
            <span>T_d <span className="font-mono text-ink-primary">{entry.Tdischarge.toFixed(0)}°C</span></span>
            <span>{t('assemblyWorkshop.onTargetLabel')} <span className={`font-mono ${entry.reachedTarget ? 'text-accent-measure' : 'text-accent-fault'}`}>{entry.reachedTarget ? '✓' : '✗'}</span></span>
            <span>fault <span className={`font-mono ${entry.faultCount > 0 ? 'text-accent-fault' : 'text-accent-measure'}`}>{entry.faultCount}</span></span>
            <span>warn <span className="font-mono text-ink-primary">{entry.warnCount}</span></span>
            <span className="truncate">PFC <span className="font-mono text-ink-primary">{pfc?.vdcOutput}V</span></span>
          </div>
        </div>
        <button
          type="button"
          onClick={onApply}
          title={t('assemblyWorkshop.loadBackTitle')}
          className="shrink-0 rounded border border-line-subtle bg-bg-surface p-1.5 text-ink-muted transition-colors hover:bg-accent-primary/10 hover:text-accent-primary"
          aria-label={t('assemblyWorkshop.loadBackAria')}
        >
          <ArrowRightCircle className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function MiniKpi({ label, value, delta, positiveBetter, tone }: { label: string; value: string; delta?: number; positiveBetter?: boolean; tone?: 'measure' | 'fault' }) {
  let deltaCls = '';
  let deltaStr = '';
  if (delta !== undefined && Math.abs(delta) > 0.01) {
    const better = positiveBetter ? delta > 0 : delta < 0;
    deltaCls = better ? 'text-accent-measure' : 'text-accent-fault';
    deltaStr = (delta > 0 ? '+' : '') + delta.toFixed(2);
  }
  const valueCls = tone === 'measure' ? 'text-accent-measure' : tone === 'fault' ? 'text-accent-fault' : 'text-ink-primary';
  return (
    <div className="rounded border border-line-subtle bg-bg-surface px-1.5 py-1">
      <div className="text-ink-muted">{label}</div>
      <div className={`font-mono font-medium ${valueCls}`}>{value}</div>
      {deltaStr && <div className={`font-mono ${deltaCls}`}>{deltaStr}</div>}
    </div>
  );
}


