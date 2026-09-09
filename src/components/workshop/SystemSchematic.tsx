import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { compressorBundles, type CompressorSpec, type InverterPlatform } from '../../content/compressorLibrary';
import {
  controlStrategies,
  inverterPlatforms,
  liquidSeparators,
  loadConditions,
  pfcPlatforms,
  type AssemblyResult,
  type ControlStrategy,
  type DiagnosticItem,
  type LiquidSeparator,
  type LoadCondition,
  type PfcPlatform,
} from '../../content/assemblyLibraries';
import { useSimulationStore } from '../../store/simulationStore';
import { useI18n } from '../../i18n/useI18n';

/**
 * 整机系统真图形示意图 ——
 *
 * 用 SVG 画出 6 个组件的电气/机械符号 + 三相彩色连线 + 信号方向箭头，
 * 而不是文字块网格。每个块：
 *   - 点击 → 弹 SlotPopover 选项
 *   - hover → 浮起 + 高亮
 *   - 拖到合法类别的 chip → drop 切换
 *   - running 时三相线上有彩色"电流粒子"沿路径流动
 */

const DRAG_TYPE = 'application/x-assembly-slot';

type SlotKey = 'load' | 'separator' | 'compressor' | 'pfc' | 'inverter' | 'strategy';

interface Props {
  compressor: CompressorSpec;
  inverter: InverterPlatform;
  strategy: ControlStrategy;
  load: LoadCondition;
  pfc: PfcPlatform;
  separator: LiquidSeparator;
  refrigerantMismatch: boolean;
  /** 最近一次 runAssembly 结果；用来把 fault / warn 映射到对应积木块的红/黄环 */
  result?: AssemblyResult | null;
  onSwapCompressor: (idx: number) => void;
  onSwapInverter: (idx: number) => void;
  onSwapStrategy: (idx: number) => void;
  onSwapLoad: (idx: number) => void;
  onSwapPfc: (idx: number) => void;
  onSwapSeparator: (idx: number) => void;
}

// 诊断 code → 受影响积木块（结构化映射，替代旧的 message 中文关键字 includes 匹配——
// 那是与 content 层措辞的隐性契约，content 双语化后会静默失效）。同一条诊断可能命中多个块。
const CODE_AFFECTED: Record<string, SlotKey[]> = {
  'refrigerant-mismatch': ['load', 'compressor'],
  'refrigerant-ok': [],
  'startup-incapable': ['strategy', 'compressor'],
  'saliency-weak': ['strategy', 'compressor'],
  'startup-plan-ok': [],
  'inverter-current-short': ['inverter'],
  'inverter-current-tight': ['inverter'],
  'inverter-current-ok': [],
  'discharge-over': ['compressor', 'load'],
  'discharge-near': ['compressor', 'load'],
  'discharge-ok': [],
  'pressure-ratio-over': ['compressor'],
  'iq-over-rated': ['compressor', 'inverter'],
  'iq-tight': ['compressor', 'inverter'],
  'iq-ok': [],
  'voltage-over-fw': ['strategy', 'inverter'],
  'voltage-over-nofw': ['strategy', 'inverter'],
  'voltage-ok': [],
  'ramp-over': ['separator'],
  'ramp-near': ['separator'],
  'ramp-ok': [],
  'pfc-noncompliant': ['pfc'],
  'pfc-ok': [],
  'startup-failed': ['strategy', 'load'],
  'startup-slow': ['strategy', 'load'],
  'startup-ok': [],
  'transient-flag': ['inverter'],
};

function affectedBlocks(item: DiagnosticItem): SlotKey[] {
  return CODE_AFFECTED[item.code] ?? [];
}

/** 由诊断结果计算每个 slot 的最高告警等级（fault > warn > none） */
function computeFaultMap(result: AssemblyResult | null | undefined): Record<SlotKey, 'none' | 'warn' | 'fault'> {
  const map: Record<SlotKey, 'none' | 'warn' | 'fault'> = {
    load: 'none', separator: 'none', compressor: 'none', pfc: 'none', inverter: 'none', strategy: 'none',
  };
  if (!result) return map;
  for (const item of result.items) {
    if (item.level === 'ok') continue;
    const blocks = affectedBlocks(item);
    for (const b of blocks) {
      if (item.level === 'fault') map[b] = 'fault';
      else if (item.level === 'warn' && map[b] === 'none') map[b] = 'warn';
    }
  }
  return map;
}

export function SystemSchematic({
  compressor, inverter, strategy, load, pfc, separator, refrigerantMismatch, result,
  onSwapCompressor, onSwapInverter, onSwapStrategy, onSwapLoad, onSwapPfc, onSwapSeparator,
}: Props) {
  const { t } = useI18n();
  const time = useSimulationStore((s) => s.time);
  const running = useSimulationStore((s) => s.running);
  const [openSlot, setOpenSlot] = useState<SlotKey | null>(null);
  // 把诊断结果映射成每块的告警等级
  const faultMap = useMemo(() => computeFaultMap(result), [result]);

  // ESC 关闭 popover
  useEffect(() => {
    if (!openSlot) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenSlot(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSlot]);

  // 三相电流粒子沿连线移动的相位（0..1 周期 1.2s）
  const phase = running ? (time % 1.2) / 1.2 : 0;

  return (
    <div className="relative rounded-xl border border-line-subtle bg-bg-base p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-caption uppercase tracking-[0.18em] text-ink-muted">System Schematic · {t('assemblyWorkshop.schematicHint')}</p>
        {refrigerantMismatch && (
          <span className="flex items-center gap-1 rounded border border-accent-fault/60 bg-accent-fault/10 px-1.5 py-0.5 text-caption text-accent-fault">
            <AlertTriangle className="h-3 w-3" />{t('assemblyWorkshop.refrigerantMismatch')}
          </span>
        )}
      </div>

      <svg viewBox="0 0 720 420" className="w-full" aria-label={t('assemblyWorkshop.schematicAria')}>
        <defs>
          {/* 箭头 marker */}
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#9eb5cb" />
          </marker>
          <marker id="arrowPrim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="rgb(52 214 255)" />
          </marker>
          {/* 散热/工质背景渐变 */}
          <linearGradient id="evapGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(52 214 255 / 0.15)" />
            <stop offset="100%" stopColor="rgb(52 214 255 / 0.05)" />
          </linearGradient>
        </defs>

        {/* 区域分隔标签 */}
        <text x="14" y="16" fontSize="9" fill="#9eb5cb" fontFamily="ui-monospace, monospace">{t('assemblyWorkshop.coolingLoopLabel')}</text>
        <text x="14" y="268" fontSize="9" fill="#9eb5cb" fontFamily="ui-monospace, monospace">{t('assemblyWorkshop.electricLoopLabel')}</text>

        {/* —— 制冷链路：完整 4 状态点闭环 —— */}
        <LoadBlock x={20} y={30} load={load} active={openSlot === 'load'} onClick={() => setOpenSlot(openSlot === 'load' ? null : 'load')} onSwap={onSwapLoad} faultLevel={faultMap.load} />
        <DashedFlow from={[140, 80]} to={[200, 80]} label="τ_load" sub="N·m" />
        <SeparatorBlock x={200} y={30} separator={separator} active={openSlot === 'separator'} onClick={() => setOpenSlot(openSlot === 'separator' ? null : 'separator')} onSwap={onSwapSeparator} faultLevel={faultMap.separator} />
        {/* [1] 吸气过热气 → 压缩机 */}
        <RefrigerantPipe from={[320, 80]} to={[380, 80]} stateLabel="[1]" stateName={t('assemblyWorkshop.pipeSuctionGas')} hint={t('assemblyWorkshop.pipeSuctionHint')} phase={phase} running={running} />
        <CompressorBlock x={380} y={20} compressor={compressor} active={openSlot === 'compressor'} onClick={() => setOpenSlot(openSlot === 'compressor' ? null : 'compressor')} onSwap={onSwapCompressor} time={time} running={running} faultLevel={faultMap.compressor} />
        {/* [2] 排气高温高压气 → 冷凝器 */}
        <RefrigerantPipe from={[540, 80]} to={[600, 80]} stateLabel="[2]" stateName={t('assemblyWorkshop.pipeDischarge')} hint={t('assemblyWorkshop.pipeDischargeHint')} phase={phase} running={running} hot />
        <CondenserSchematic x={600} y={30} />

        {/* [3] 冷凝过冷液 → EEV 节流阀（从冷凝器底部沿管路向下再向左） */}
        <RefrigerantPipeBent
          waypoints={[[650, 130], [650, 195], [380, 195], [380, 220]]}
          stateLabel="[3]"
          stateName={t('assemblyWorkshop.pipeSubcooledLiquid')}
          hint={t('assemblyWorkshop.pipeSubcooledHint')}
          phase={phase}
          running={running}
        />
        <EEVBlock x={350} y={180} />
        {/* [4] 节流后两相 → 蒸发器（沿管路向左） */}
        <RefrigerantPipeBent
          waypoints={[[340, 195], [220, 195]]}
          stateLabel="[4]"
          stateName={t('assemblyWorkshop.pipeTwoPhase')}
          hint={t('assemblyWorkshop.pipeTwoPhaseHint')}
          phase={phase}
          running={running}
          cold
        />
        <EvaporatorSchematic x={130} y={170} />
        {/* 闭环：蒸发器 → 分离器（吸气回路） */}
        <RefrigerantPipeBent
          waypoints={[[130, 195], [80, 195], [80, 130]]}
          stateLabel=""
          stateName=""
          hint=""
          phase={phase}
          running={running}
        />
        {/* 室内热负荷箭头：工况室内温度 → 蒸发器 */}
        <text x="155" y="215" fontSize="8" fill="#ffb84d">{t('assemblyWorkshop.indoorHeat')}</text>
        {/* 室外散热箭头：冷凝器 → 室外 */}
        <text x="610" y="148" fontSize="8" fill="#ff5c7a">{t('assemblyWorkshop.outdoorHeat')}</text>

        {/* —— 电气链路 —— */}
        <PfcBlock x={20} y={280} pfc={pfc} active={openSlot === 'pfc'} onClick={() => setOpenSlot(openSlot === 'pfc' ? null : 'pfc')} onSwap={onSwapPfc} faultLevel={faultMap.pfc} />
        <VdcFlow from={[140, 330]} to={[200, 330]} label="Vdc" value={`${pfc.vdcOutput}V`} />
        <InverterBlock x={200} y={270} inverter={inverter} active={openSlot === 'inverter'} onClick={() => setOpenSlot(openSlot === 'inverter' ? null : 'inverter')} onSwap={onSwapInverter} time={time} running={running} faultLevel={faultMap.inverter} />
        <DutyFlow from={[440, 330]} to={[380, 330]} label="duty" />
        <ControllerBlock x={440} y={280} strategy={strategy} mcuPartNo={inverter.mcuPartNo} active={openSlot === 'strategy'} onClick={() => setOpenSlot(openSlot === 'strategy' ? null : 'strategy')} onSwap={onSwapStrategy} faultLevel={faultMap.strategy} />

        {/* —— 跨链路连接：变频器输出 → 压缩机定子的三相 Iabc —— */}
        <ThreePhaseLines from={[320, 270]} to={[460, 110]} phase={phase} running={running} />

        {/* 反电动势反馈：压缩机 → 控制器（点划线表示信号） */}
        <FeedbackLine from={[510, 110]} to={[510, 280]} label="θ / BEMF" />
      </svg>

      {/* popover 选项 —— 渲染在 SVG 上方 */}
      {openSlot && (
        <SlotPopover
          slot={openSlot}
          compressor={compressor}
          inverter={inverter}
          strategy={strategy}
          load={load}
          pfc={pfc}
          separator={separator}
          onPick={(s, i) => {
            if (s === 'load') onSwapLoad(i);
            if (s === 'separator') onSwapSeparator(i);
            if (s === 'compressor') onSwapCompressor(i);
            if (s === 'pfc') onSwapPfc(i);
            if (s === 'inverter') onSwapInverter(i);
            if (s === 'strategy') onSwapStrategy(i);
            setOpenSlot(null);
          }}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </div>
  );
}

// ———————————————————— 通用块壳（处理 hover / click / drop） ————————————————————

interface BlockShellProps {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
  toneStroke: string;
  toneFill: string;
  acceptCategory: SlotKey;
  /** 诊断告警等级，影响外环颜色：fault=红 / warn=黄 / none=不画外环 */
  faultLevel?: 'none' | 'warn' | 'fault';
  onClick: () => void;
  onSwap: (idx: number) => void;
  children: React.ReactNode;
  title?: string;
}

function BlockShell({ x, y, w, h, active, toneStroke, toneFill, acceptCategory, faultLevel = 'none', onClick, onSwap, children, title }: BlockShellProps) {
  const { t } = useI18n();
  const [hover, setHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const highlight = active || hover || dragOver;
  // 诊断 fault/warn 覆盖默认 tone 着色
  const baseStrokeForFault = faultLevel === 'fault' ? 'rgb(255 92 122 / 0.85)'
    : faultLevel === 'warn' ? 'rgb(255 184 77 / 0.75)'
    : toneStroke;
  const baseFillForFault = faultLevel === 'fault' ? 'rgb(255 92 122 / 0.10)'
    : faultLevel === 'warn' ? 'rgb(255 184 77 / 0.08)'
    : toneFill;
  const strokeWidth = active || dragOver ? 2.5 : faultLevel !== 'none' ? 2 : hover ? 1.5 : 1;
  const stroke = active || dragOver ? 'rgb(52 214 255)' : baseStrokeForFault;
  const fill = dragOver ? 'rgb(52 214 255 / 0.18)' : baseFillForFault;

  const handleDragEnter = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE)) {
      e.preventDefault();
    }
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const data = e.dataTransfer.getData(DRAG_TYPE);
    if (!data) return;
    const [cat, idxStr] = data.split(':');
    if (cat !== acceptCategory) return;
    const idx = parseInt(idxStr, 10);
    if (!Number.isNaN(idx)) onSwap(idx);
  };

  // 键盘等效：Enter / Space 触发等价 onClick（搭积木 a11y 要求：所有交互必须可键盘操作）
  const handleKeyDown = (e: React.KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  // 给 SR 用户的状态语义：active / fault / warn 都需要文本读出
  const statusSr = active ? t('assemblyWorkshop.blockExpanded') : faultLevel === 'fault' ? t('assemblyWorkshop.blockFault') : faultLevel === 'warn' ? t('assemblyWorkshop.blockWarn') : t('assemblyWorkshop.blockClickable');
  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      tabIndex={0}
      role="button"
      aria-pressed={active}
      aria-label={title ? `${title}：${statusSr}` : statusSr}
      onKeyDown={handleKeyDown}
    >
      <title>{title}</title>
      <rect
        width={w}
        height={h}
        rx={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        style={{ transition: 'all 0.15s' }}
      />
      {highlight && (
        <rect
          width={w}
          height={h}
          rx={8}
          fill="none"
          stroke="rgb(52 214 255 / 0.4)"
          strokeWidth={5}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {faultLevel === 'fault' && !dragOver && (
        <>
          {/* 红色脉动外环表示 fault */}
          <rect
            width={w}
            height={h}
            rx={8}
            fill="none"
            stroke="rgb(255 92 122 / 0.45)"
            strokeWidth={5}
            style={{ pointerEvents: 'none' }}
          >
            <animate attributeName="stroke-opacity" values="0.25;0.75;0.25" dur="1.5s" repeatCount="indefinite" />
          </rect>
          {/* 角标 ⚠ */}
          <g transform={`translate(${w - 10}, 4)`} style={{ pointerEvents: 'none' }}>
            <circle r="7" fill="#ff5c7a" stroke="rgb(7 17 31)" strokeWidth="1.5" />
            <text x="0" y="3" fontSize="10" fill="rgb(7 17 31)" textAnchor="middle" fontWeight="700">!</text>
          </g>
        </>
      )}
      {faultLevel === 'warn' && !dragOver && (
        <g transform={`translate(${w - 10}, 4)`} style={{ pointerEvents: 'none' }}>
          <circle r="6" fill="#ffb84d" stroke="rgb(7 17 31)" strokeWidth="1.5" />
          <text x="0" y="3" fontSize="9" fill="rgb(7 17 31)" textAnchor="middle" fontWeight="700">!</text>
        </g>
      )}
      {dragOver && (
        <text x={w / 2} y={h + 12} fontSize="9" fill="rgb(52 214 255)" textAnchor="middle" fontWeight="600">
          DROP ↓
        </text>
      )}
      {children}
    </g>
  );
}

// ———————————————————— 各积木的视觉绘制 ————————————————————

function LoadBlock({ x, y, load, active, onClick, onSwap, faultLevel }: { x: number; y: number; load: LoadCondition; active: boolean; onClick: () => void; onSwap: (i: number) => void; faultLevel: 'none' | 'warn' | 'fault' }) {
  const { t } = useI18n();
  return (
    <BlockShell x={x} y={y} w={120} h={100} active={active} toneStroke="rgb(255 184 77 / 0.7)" toneFill="rgb(255 184 77 / 0.06)" acceptCategory="load" onClick={onClick} onSwap={onSwap} faultLevel={faultLevel} title={`${t('assemblyWorkshop.blockTitleLoad')}${load.name}`}>
      {/* 温度计 */}
      <g transform="translate(12, 10)">
        <rect x="0" y="0" width="6" height="32" rx="3" fill="none" stroke="#ffb84d" strokeWidth="1.4" />
        <line x1="3" y1="6" x2="3" y2="28" stroke="#ffb84d" strokeWidth="1.4" />
        <circle cx="3" cy="34" r="5" fill="#ffb84d" />
      </g>
      {/* 雪花 */}
      <g transform="translate(40, 18) scale(0.6)" stroke="#34d6ff" strokeWidth="1.5" fill="none">
        <line x1="0" y1="-12" x2="0" y2="12" />
        <line x1="-10" y1="-6" x2="10" y2="6" />
        <line x1="-10" y1="6" x2="10" y2="-6" />
      </g>
      {/* 房屋表示室内 vs 室外 */}
      <g transform="translate(72, 14)" stroke="#9eb5cb" strokeWidth="1" fill="none">
        <path d="M 0 12 L 12 0 L 24 12 L 24 28 L 0 28 Z" />
        <text x="12" y="22" fontSize="7" fill="#9eb5cb" textAnchor="middle">In</text>
      </g>
      <text x="8" y="62" fontSize="11" fill="#ffb84d" fontWeight="600">{t('assemblyWorkshop.slotLoad')}</text>
      <text x="8" y="78" fontSize="9" fill="#e7f3ff">T_e={load.Te}°C / T_c={load.Tc}°C</text>
      <text x="8" y="92" fontSize="9" fill="#9eb5cb">target {load.targetRpm} rpm</text>
    </BlockShell>
  );
}

function SeparatorBlock({ x, y, separator, active, onClick, onSwap, faultLevel }: { x: number; y: number; separator: LiquidSeparator; active: boolean; onClick: () => void; onSwap: (i: number) => void; faultLevel: 'none' | 'warn' | 'fault' }) {
  const { t } = useI18n();
  const none = separator.id === 'none';
  const stroke = none ? 'rgb(255 184 77 / 0.7)' : 'rgb(67 247 181 / 0.7)';
  const fill = none ? 'rgb(255 184 77 / 0.06)' : 'rgb(67 247 181 / 0.06)';
  return (
    <BlockShell x={x} y={y} w={120} h={100} active={active} toneStroke={stroke} toneFill={fill} acceptCategory="separator" onClick={onClick} onSwap={onSwap} faultLevel={faultLevel} title={`${t('assemblyWorkshop.blockTitleSeparator')}${separator.name}`}>
      {/* U 型管 + 液滴示意 */}
      <g transform="translate(15, 12)" stroke={none ? '#ffb84d' : '#43f7b5'} strokeWidth="2" fill="none">
        <path d="M 5 0 L 5 30 Q 5 42 15 42 Q 25 42 25 30 L 25 0" />
        {!none && (
          <>
            <circle cx="15" cy="36" r="3" fill="#43f7b5" />
            <circle cx="11" cy="32" r="1.5" fill="#43f7b5" />
            <circle cx="19" cy="32" r="1.5" fill="#43f7b5" />
          </>
        )}
        {none && (
          <text x="15" y="36" fontSize="14" fill="#ff5c7a" textAnchor="middle">✕</text>
        )}
      </g>
      <g transform="translate(58, 16)" stroke="#9eb5cb" strokeWidth="1" fill="none">
        <line x1="0" y1="14" x2="50" y2="14" strokeDasharray="3 3" />
        <text x="0" y="10" fontSize="7" fill="#9eb5cb">{t('assemblyWorkshop.separatorGasUp')}</text>
        <text x="0" y="26" fontSize="7" fill="#9eb5cb">{t('assemblyWorkshop.separatorLiquidDown')}</text>
      </g>
      <text x="8" y="68" fontSize="11" fill={none ? '#ffb84d' : '#43f7b5'} fontWeight="600">{t('assemblyWorkshop.slotSeparatorFull')}</text>
      <text x="8" y="82" fontSize="9" fill="#e7f3ff">{none ? t('assemblyWorkshop.noSeparatorInline') : separator.name.replace(/\（[^)]+\）/, '').trim()}</text>
      <text x="8" y="94" fontSize="9" fill="#9eb5cb">{t('assemblyWorkshop.rampCapacity').replace('{n}', String(separator.maxRampRpmS))}</text>
    </BlockShell>
  );
}

function CompressorBlock({ x, y, compressor, active, onClick, onSwap, time, running, faultLevel }: { x: number; y: number; compressor: CompressorSpec; active: boolean; onClick: () => void; onSwap: (i: number) => void; time: number; running: boolean; faultLevel: 'none' | 'warn' | 'fault' }) {
  const { t } = useI18n();
  // 转子旋转角（机械角）：真实 rpm 太快会糊成圈（5400rpm = 90rev/s），
  // 用一个可视化降速比让用户看清转子方向（约 maxRpm 时 1 转 / 2-3s）
  const VISUAL_SCALE = 0.005;
  const rps = (compressor.maxRpm * 0.6) / 60;
  const rotorDeg = running ? (time * rps * 360 * VISUAL_SCALE * 100) % 360 : 0;
  return (
    <BlockShell x={x} y={y} w={160} h={120} active={active} toneStroke="rgb(67 247 181 / 0.7)" toneFill="rgb(67 247 181 / 0.06)" acceptCategory="compressor" onClick={onClick} onSwap={onSwap} faultLevel={faultLevel} title={`${t('assemblyWorkshop.blockTitleCompressor')}${compressor.brand} ${compressor.partNo}`}>
      {/* 外壳（静态定子边框）*/}
      <rect x="10" y="8" width="100" height="70" rx="6" fill="none" stroke="#43f7b5" strokeWidth="1.4" />
      {/* 定子绕组槽（静态，三相分布 U-V-W）*/}
      <g transform="translate(60, 43)">
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2;
          return <circle key={`slot-${i}`} cx={Math.cos(a) * 28} cy={Math.sin(a) * 28} r="2.5" fill="none" stroke="#43f7b550" strokeWidth="1" />;
        })}
      </g>
      {/* 转子（按 rpm 实时旋转，按 polePairs 显示磁极对）*/}
      <g transform={`translate(60, 43) rotate(${rotorDeg})`}>
        <circle r="22" fill="rgb(67 247 181 / 0.1)" stroke="#43f7b5" strokeWidth="1.4" />
        <circle r="3" fill="#43f7b5" />
        {Array.from({ length: compressor.polePairs * 2 }).map((_, i) => {
          const a = (i / (compressor.polePairs * 2)) * Math.PI * 2;
          const x1 = Math.cos(a) * 8;
          const y1 = Math.sin(a) * 8;
          const x2 = Math.cos(a) * 18;
          const y2 = Math.sin(a) * 18;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i % 2 === 0 ? '#ff5c7a' : '#34d6ff'} strokeWidth="2" strokeLinecap="round" />;
        })}
        {/* 轴线指示 - 方便用户看转子方向 */}
        <line x1="0" y1="0" x2="0" y2="-20" stroke="#43f7b5" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      </g>
      {/* 三相端子 */}
      <g transform="translate(120, 20)">
        <circle cx="0" cy="0" r="3" fill="#34d6ff" /><text x="6" y="3" fontSize="9" fill="#34d6ff">A</text>
        <circle cx="0" cy="20" r="3" fill="#43f7b5" /><text x="6" y="23" fontSize="9" fill="#43f7b5">B</text>
        <circle cx="0" cy="40" r="3" fill="#ffb84d" /><text x="6" y="43" fontSize="9" fill="#ffb84d">C</text>
      </g>
      <text x="8" y="92" fontSize="11" fill="#43f7b5" fontWeight="600">{compressor.brand.split('（')[0]} {t('assemblyWorkshop.slotCompressor')}</text>
      <text x="8" y="106" fontSize="9" fill="#e7f3ff">{compressor.partNo} · {compressor.hp}HP · {compressor.refrigerant}</text>
      <text x="8" y="116" fontSize="8" fill="#9eb5cb">p={compressor.polePairs}, Lq/Ld={(compressor.lqMh / compressor.ldMh).toFixed(2)}</text>
    </BlockShell>
  );
}

function CondenserSchematic({ x, y }: { x: number; y: number }) {
  const { t } = useI18n();
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect width="100" height="100" rx="8" fill="rgb(255 92 122 / 0.08)" stroke="#ff5c7a80" strokeWidth="1" strokeDasharray="3 3" />
      {/* 冷凝盘管（蛇形）—— 暖色表示放热 */}
      <path d="M 10 16 Q 30 16 30 28 Q 30 40 50 40 Q 70 40 70 52 Q 70 64 90 64 L 90 80" fill="none" stroke="#ff5c7a" strokeWidth="2" />
      <text x="8" y="14" fontSize="9" fill="#ff5c7a" fontWeight="600">{t('assemblyWorkshop.condenser')}</text>
      <text x="8" y="96" fontSize="8" fill="#9eb5cb">{t('assemblyWorkshop.condenserFlow')}</text>
    </g>
  );
}

function EvaporatorSchematic({ x, y }: { x: number; y: number }) {
  const { t } = useI18n();
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect width="90" height="50" rx="6" fill="url(#evapGrad)" stroke="#34d6ff80" strokeWidth="1" strokeDasharray="3 3" />
      {/* 蒸发盘管（蛇形）—— 冷色表示吸热 */}
      <path d="M 8 12 Q 20 12 20 22 Q 20 32 35 32 Q 50 32 50 22 Q 50 12 65 12 Q 80 12 80 22 Q 80 32 88 32" fill="none" stroke="#34d6ff" strokeWidth="2" />
      <text x="6" y="46" fontSize="8" fill="#34d6ff" fontWeight="600">{t('assemblyWorkshop.evaporator')}</text>
      <text x="38" y="46" fontSize="7" fill="#9eb5cb">{t('assemblyWorkshop.evaporatorFlow')}</text>
    </g>
  );
}

function EEVBlock({ x, y }: { x: number; y: number }) {
  const { t } = useI18n();
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* 节流阀符号：两个三角形对顶 */}
      <rect width="60" height="32" rx="4" fill="rgb(167 139 250 / 0.08)" stroke="#a78bfa80" strokeWidth="1" />
      <polygon points="20,8 20,24 30,16" fill="#a78bfa" />
      <polygon points="40,8 40,24 30,16" fill="#a78bfa" />
      <text x="30" y="44" fontSize="8" fill="#a78bfa" textAnchor="middle" fontWeight="600">{t('assemblyWorkshop.eevLabel')}</text>
      <text x="30" y="-2" fontSize="7" fill="#9eb5cb" textAnchor="middle">{t('assemblyWorkshop.eevHint')}</text>
    </g>
  );
}

// 直管路（带 state 标签 + 流动粒子）
function RefrigerantPipe({ from, to, stateLabel, stateName, hint, phase, running, hot, cold }: {
  from: [number, number];
  to: [number, number];
  stateLabel: string;
  stateName: string;
  hint: string;
  phase: number;
  running: boolean;
  hot?: boolean;
  cold?: boolean;
}) {
  const color = hot ? '#ff5c7a' : cold ? '#34d6ff' : '#9eb5cb';
  const midX = (from[0] + to[0]) / 2;
  const midY = (from[1] + to[1]) / 2;
  // 粒子位置：t ∈ [0, 1]
  const t = phase;
  const px = from[0] + (to[0] - from[0]) * t;
  const py = from[1] + (to[1] - from[1]) * t;
  return (
    <g>
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={color} strokeWidth="2" markerEnd="url(#arrow)" />
      {running && <circle cx={px} cy={py} r="3" fill={color} opacity="0.9" />}
      {stateLabel && (
        <g>
          <circle cx={midX} cy={midY - 14} r="9" fill="rgb(13 25 41)" stroke={color} strokeWidth="1.5" />
          <text x={midX} y={midY - 11} fontSize="9" fill={color} textAnchor="middle" fontWeight="700">{stateLabel}</text>
        </g>
      )}
      {stateName && (
        <text x={midX} y={midY + 14} fontSize="7" fill="#e7f3ff" textAnchor="middle">{stateName}</text>
      )}
      {hint && (
        <text x={midX} y={midY + 24} fontSize="7" fill="#9eb5cb" textAnchor="middle">{hint}</text>
      )}
    </g>
  );
}

// 折线管路（waypoints）+ 流动粒子（线性插值 across 整条折线长度）
function RefrigerantPipeBent({ waypoints, stateLabel, stateName, hint, phase, running, hot, cold }: {
  waypoints: Array<[number, number]>;
  stateLabel: string;
  stateName: string;
  hint: string;
  phase: number;
  running: boolean;
  hot?: boolean;
  cold?: boolean;
}) {
  const color = hot ? '#ff5c7a' : cold ? '#34d6ff' : '#9eb5cb';
  // 累计每段长度，按 phase 找当前粒子点
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    const dx = waypoints[i][0] - waypoints[i - 1][0];
    const dy = waypoints[i][1] - waypoints[i - 1][1];
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    total += len;
  }
  let cur = phase * total;
  let px = waypoints[0][0];
  let py = waypoints[0][1];
  for (let i = 0; i < segLens.length; i += 1) {
    if (cur <= segLens[i]) {
      const ratio = cur / segLens[i];
      px = waypoints[i][0] + (waypoints[i + 1][0] - waypoints[i][0]) * ratio;
      py = waypoints[i][1] + (waypoints[i + 1][1] - waypoints[i][1]) * ratio;
      break;
    }
    cur -= segLens[i];
  }
  // 找一个适合放 state 标签的中点（取折线长度 50% 位置）
  let labelCur = total * 0.5;
  let lx = waypoints[0][0];
  let ly = waypoints[0][1];
  for (let i = 0; i < segLens.length; i += 1) {
    if (labelCur <= segLens[i]) {
      const ratio = labelCur / segLens[i];
      lx = waypoints[i][0] + (waypoints[i + 1][0] - waypoints[i][0]) * ratio;
      ly = waypoints[i][1] + (waypoints[i + 1][1] - waypoints[i][1]) * ratio;
      break;
    }
    labelCur -= segLens[i];
  }
  const pathD = waypoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  return (
    <g>
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" markerEnd="url(#arrow)" />
      {running && <circle cx={px} cy={py} r="3" fill={color} opacity="0.9" />}
      {stateLabel && (
        <g>
          <circle cx={lx} cy={ly - 12} r="9" fill="rgb(13 25 41)" stroke={color} strokeWidth="1.5" />
          <text x={lx} y={ly - 9} fontSize="9" fill={color} textAnchor="middle" fontWeight="700">{stateLabel}</text>
        </g>
      )}
      {stateName && (
        <text x={lx} y={ly + 16} fontSize="7" fill="#e7f3ff" textAnchor="middle">{stateName}</text>
      )}
      {hint && (
        <text x={lx} y={ly + 26} fontSize="7" fill="#9eb5cb" textAnchor="middle">{hint}</text>
      )}
    </g>
  );
}

function PfcBlock({ x, y, pfc, active, onClick, onSwap, faultLevel }: { x: number; y: number; pfc: PfcPlatform; active: boolean; onClick: () => void; onSwap: (i: number) => void; faultLevel: 'none' | 'warn' | 'fault' }) {
  const { t } = useI18n();
  const ok = pfc.meetsHarmonicStandard;
  const tone = ok ? 'rgb(52 214 255 / 0.7)' : 'rgb(255 184 77 / 0.7)';
  const fill = ok ? 'rgb(52 214 255 / 0.06)' : 'rgb(255 184 77 / 0.06)';
  return (
    <BlockShell x={x} y={y} w={120} h={120} active={active} toneStroke={tone} toneFill={fill} acceptCategory="pfc" onClick={onClick} onSwap={onSwap} faultLevel={faultLevel} title={`${t('assemblyWorkshop.blockTitlePfc')}${pfc.name}`}>
      {/* 电感 L 符号 + 二极管 + 电容 */}
      <g stroke={ok ? '#34d6ff' : '#ffb84d'} strokeWidth="1.5" fill="none">
        {/* 输入 ~ 整流桥 */}
        <text x="6" y="22" fontSize="9" fill="#9eb5cb">L1/N</text>
        {/* 电感（弧形） */}
        <path d="M 36 26 q 4 -8 8 0 q 4 -8 8 0 q 4 -8 8 0 q 4 -8 8 0" />
        <text x="42" y="14" fontSize="8" fill={ok ? '#34d6ff' : '#ffb84d'}>L</text>
        {/* 二极管 */}
        <path d="M 76 26 L 88 26" />
        <polygon points="84,22 84,30 92,26" fill={ok ? '#34d6ff' : '#ffb84d'} />
        {/* 电容（双竖线） */}
        <line x1="100" y1="18" x2="100" y2="34" />
        <line x1="106" y1="14" x2="106" y2="38" />
        <text x="98" y="48" fontSize="7" fill="#9eb5cb">Cdc</text>
        {/* 开关 */}
        <circle cx="55" cy="48" r="6" fill="rgb(7 17 31)" />
        <text x="55" y="51" fontSize="8" fill={ok ? '#34d6ff' : '#ffb84d'} textAnchor="middle">M</text>
        <line x1="55" y1="36" x2="55" y2="42" />
        <line x1="55" y1="54" x2="55" y2="62" />
      </g>
      <text x="6" y="82" fontSize="11" fill={ok ? '#34d6ff' : '#ffb84d'} fontWeight="600">{pfc.id === 'none' ? t('assemblyWorkshop.noPfc') : pfc.id === 'vienna-3phase' ? t('assemblyWorkshop.viennaPfc') : pfc.id === 'sic-boost' ? 'SiC Boost' : 'Boost PFC'}</text>
      <text x="6" y="96" fontSize="9" fill="#e7f3ff">{t('assemblyWorkshop.pfcOutput').replace('{v}', String(pfc.vdcOutput)).replace('{pf}', String(pfc.pf))}</text>
      <text x="6" y="108" fontSize="8" fill={ok ? '#43f7b5' : '#ff5c7a'}>THD {pfc.inputThdPct}%{!ok && ` · ${t('assemblyWorkshop.exceedGb')}`}</text>
    </BlockShell>
  );
}

function InverterBlock({ x, y, inverter, active, onClick, onSwap, time, running, faultLevel }: { x: number; y: number; inverter: InverterPlatform; active: boolean; onClick: () => void; onSwap: (i: number) => void; time: number; running: boolean; faultLevel: 'none' | 'warn' | 'fault' }) {
  const { t } = useI18n();
  // 三相 PWM 模拟：让 A/B/C 三相的上桥占空比按正弦相位轮流升降，
  // 用低视觉频率 (1.5Hz，1 周期 ~ 0.67s) 让用户看清三相依次"占主导"
  const f = 1.5;
  const phaseRad = running ? 2 * Math.PI * f * time : 0;
  const computeDuty = (offsetDeg: number) => {
    const ph = phaseRad + (offsetDeg * Math.PI) / 180;
    return 0.5 + 0.4 * Math.sin(ph);
  };
  const duties = [computeDuty(0), computeDuty(-120), computeDuty(120)];
  return (
    <BlockShell x={x} y={y} w={120} h={120} active={active} toneStroke="rgb(52 214 255 / 0.7)" toneFill="rgb(52 214 255 / 0.06)" acceptCategory="inverter" onClick={onClick} onSwap={onSwap} faultLevel={faultLevel} title={`${t('assemblyWorkshop.blockTitleInverter')}${inverter.ipmBrand} ${inverter.ipmPartNo}`}>
      {/* IPM 外框 */}
      <rect x="10" y="10" width="100" height="60" rx="4" fill="rgb(7 17 31)" stroke="#34d6ff" strokeWidth="1.4" />
      {/* 6 个 IGBT 开关：上桥亮度跟 duty，下桥亮度跟 1-duty（互补 PWM）*/}
      {[0, 1, 2].map((col) => {
        const duty = duties[col];
        const upOpacity = 0.3 + duty * 0.7;
        const downOpacity = 0.3 + (1 - duty) * 0.7;
        return (
          <g key={col} transform={`translate(${22 + col * 28}, 18)`}>
            {/* 上桥 */}
            <rect x="0" y="0" width="14" height="14" rx="2" fill="#34d6ff" opacity={upOpacity} />
            <text x="7" y="11" fontSize="7" fill="#07111f" textAnchor="middle" fontWeight="600">H</text>
            {/* 下桥 */}
            <rect x="0" y="20" width="14" height="14" rx="2" fill="#34d6ff" opacity={downOpacity} />
            <text x="7" y="31" fontSize="7" fill="#e7f3ff" textAnchor="middle" fontWeight="600">L</text>
          </g>
        );
      })}
      <text x="60" y="64" fontSize="7" fill="#9eb5cb" textAnchor="middle">{inverter.ipmPartNo}</text>
      {/* 输出端子（3 相） */}
      <g transform="translate(60, 76)">
        <circle cx="-20" cy="0" r="3" fill="#34d6ff" /><text x="-20" y="14" fontSize="8" fill="#34d6ff" textAnchor="middle">U</text>
        <circle cx="0" cy="0" r="3" fill="#43f7b5" /><text x="0" y="14" fontSize="8" fill="#43f7b5" textAnchor="middle">V</text>
        <circle cx="20" cy="0" r="3" fill="#ffb84d" /><text x="20" y="14" fontSize="8" fill="#ffb84d" textAnchor="middle">W</text>
      </g>
      <text x="6" y="106" fontSize="9" fill="#34d6ff" fontWeight="600">{inverter.ipmBrand}</text>
      <text x="6" y="116" fontSize="8" fill="#9eb5cb">{inverter.ratedCurrentA}A · {(inverter.pwmFreqHz / 1000).toFixed(1)}kHz · td {inverter.deadTimeUs}μs</text>
    </BlockShell>
  );
}

function ControllerBlock({ x, y, strategy, mcuPartNo, active, onClick, onSwap, faultLevel }: { x: number; y: number; strategy: ControlStrategy; mcuPartNo: string; active: boolean; onClick: () => void; onSwap: (i: number) => void; faultLevel: 'none' | 'warn' | 'fault' }) {
  const { t } = useI18n();
  const vendor = /STM32/i.test(mcuPartNo) ? 'STM32' : /RX|Renesas/i.test(mcuPartNo) ? 'Renesas RX' : /TMS320|TI/i.test(mcuPartNo) ? 'TI C2000' : 'MCU';
  return (
    <BlockShell x={x} y={y} w={120} h={120} active={active} toneStroke="rgb(52 214 255 / 0.7)" toneFill="rgb(52 214 255 / 0.06)" acceptCategory="strategy" onClick={onClick} onSwap={onSwap} faultLevel={faultLevel} title={`${t('assemblyWorkshop.blockTitleController')}${strategy.name}`}>
      {/* MCU 芯片 + 引脚 */}
      <rect x="22" y="14" width="76" height="56" rx="3" fill="rgb(7 17 31)" stroke="#34d6ff" strokeWidth="1.4" />
      {/* 左右各 6 引脚 */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <line x1="14" y1={20 + i * 8} x2="22" y2={20 + i * 8} stroke="#9eb5cb" strokeWidth="1.2" />
          <line x1="98" y1={20 + i * 8} x2="106" y2={20 + i * 8} stroke="#9eb5cb" strokeWidth="1.2" />
        </g>
      ))}
      <text x="60" y="38" fontSize="8" fill="#34d6ff" textAnchor="middle" fontWeight="600">{vendor}</text>
      <text x="60" y="50" fontSize="7" fill="#e7f3ff" textAnchor="middle">{strategy.id.includes('hfi') ? 'HFI+BEMF' : strategy.id.includes('bemf') ? 'BEMF' : strategy.id.includes('encoder') ? 'ENC' : 'V/f'}</text>
      <text x="60" y="62" fontSize="7" fill="#9eb5cb" textAnchor="middle">FOC fast loop</text>
      <text x="6" y="92" fontSize="11" fill="#34d6ff" fontWeight="600">{t('assemblyWorkshop.mainControlLabel')}</text>
      <text x="6" y="106" fontSize="8" fill="#e7f3ff">{mcuPartNo}</text>
      <text x="6" y="116" fontSize="8" fill="#9eb5cb">{strategy.name.length > 18 ? strategy.name.slice(0, 18) + '…' : strategy.name}</text>
    </BlockShell>
  );
}

// ———————————————————— 连线组件 ————————————————————

function DashedFlow({ from, to, label, sub }: { from: [number, number]; to: [number, number]; label: string; sub?: string }) {
  return (
    <g>
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="#9eb5cb" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrow)" />
      <text x={(from[0] + to[0]) / 2} y={from[1] - 6} fontSize="8" fill="#9eb5cb" textAnchor="middle">{label}</text>
      {sub && <text x={(from[0] + to[0]) / 2} y={from[1] + 12} fontSize="7" fill="#9eb5cb" textAnchor="middle">{sub}</text>}
    </g>
  );
}

function VdcFlow({ from, to, label, value }: { from: [number, number]; to: [number, number]; label: string; value: string }) {
  return (
    <g>
      {/* 双线表示 DC 母线 */}
      <line x1={from[0]} y1={from[1] - 4} x2={to[0]} y2={to[1] - 4} stroke="#ff5c7a" strokeWidth="2" markerEnd="url(#arrow)" />
      <line x1={from[0]} y1={from[1] + 4} x2={to[0]} y2={to[1] + 4} stroke="#34d6ff" strokeWidth="2" />
      <text x={(from[0] + to[0]) / 2} y={from[1] - 10} fontSize="8" fill="#ff5c7a" textAnchor="middle">+{value}</text>
      <text x={(from[0] + to[0]) / 2} y={from[1] + 18} fontSize="8" fill="#34d6ff" textAnchor="middle">{label}</text>
    </g>
  );
}

function DutyFlow({ from, to, label }: { from: [number, number]; to: [number, number]; label: string }) {
  const { t } = useI18n();
  return (
    <g>
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="rgb(52 214 255)" strokeWidth="1.5" strokeDasharray="6 2" markerEnd="url(#arrowPrim)" />
      <text x={(from[0] + to[0]) / 2} y={from[1] - 6} fontSize="8" fill="#34d6ff" textAnchor="middle">{label}</text>
      <text x={(from[0] + to[0]) / 2} y={from[1] + 12} fontSize="7" fill="#9eb5cb" textAnchor="middle">{t('assemblyWorkshop.dutyPwmHint')}</text>
    </g>
  );
}

function ThreePhaseLines({ from, to, phase, running }: { from: [number, number]; to: [number, number]; phase: number; running: boolean }) {
  const { t } = useI18n();
  const colors = ['#34d6ff', '#43f7b5', '#ffb84d'];
  const offsets = [-4, 0, 4];
  return (
    <g>
      {colors.map((color, i) => {
        const fromX = from[0];
        const fromY = from[1] + offsets[i] * 2;
        const toX = to[0];
        const toY = to[1] + offsets[i] * 2;
        const midX = (fromX + toX) / 2;
        const d = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
        // 粒子位置（用 phase * pathLength 模拟，简单线性插值）
        const tp = (phase + i * 0.33) % 1;
        const dotX = fromX + (toX - fromX) * tp;
        const dotY = fromY + (toY - fromY) * tp;
        return (
          <g key={i}>
            <path d={d} stroke={color} strokeWidth="1.8" fill="none" opacity="0.8" />
            {running && <circle cx={dotX} cy={dotY} r="3" fill={color}><title>{t('assemblyWorkshop.iabcParticles')}</title></circle>}
          </g>
        );
      })}
      <text x={(from[0] + to[0]) / 2} y={from[1] - 14} fontSize="8" fill="#34d6ff" textAnchor="middle" fontWeight="600">{t('assemblyWorkshop.iabcLabel')}</text>
    </g>
  );
}

function FeedbackLine({ from, to, label }: { from: [number, number]; to: [number, number]; label: string }) {
  return (
    <g>
      <path
        d={`M ${from[0]} ${from[1]} C ${from[0] + 30} ${from[1]}, ${to[0] + 30} ${to[1]}, ${to[0]} ${to[1]}`}
        stroke="#a78bfa"
        strokeWidth="1.2"
        strokeDasharray="2 3"
        fill="none"
        markerEnd="url(#arrow)"
      />
      <text x={from[0] + 18} y={(from[1] + to[1]) / 2} fontSize="7" fill="#a78bfa">{label}</text>
    </g>
  );
}

// ———————————————————— Popover（复用之前的 SlotPopover 逻辑） ————————————————————

function SlotPopover({
  slot, compressor, inverter, strategy, load, pfc, separator, onPick, onClose,
}: {
  slot: SlotKey;
  compressor: CompressorSpec;
  inverter: InverterPlatform;
  strategy: ControlStrategy;
  load: LoadCondition;
  pfc: PfcPlatform;
  separator: LiquidSeparator;
  onPick: (slot: SlotKey, idx: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const config = {
    load: { title: t('assemblyWorkshop.popSwitchLoad'), options: loadConditions.map((l) => ({ key: l.id, label: l.name, sub: l.brief })), currentKey: load.id },
    separator: { title: t('assemblyWorkshop.popSwitchSeparator'), options: liquidSeparators.map((s) => ({ key: s.id, label: s.name, sub: s.brief })), currentKey: separator.id },
    compressor: { title: t('assemblyWorkshop.popSwitchCompressor'), options: compressorBundles.map((b) => ({ key: b.id, label: `${b.compressor.brand} ${b.compressor.partNo}`, sub: `${b.compressor.type} · ${b.compressor.hp}HP · ${b.compressor.refrigerant}` })), currentKey: compressorBundles.find((b) => b.compressor.partNo === compressor.partNo)?.id ?? '' },
    pfc: { title: t('assemblyWorkshop.popSwitchPfc'), options: pfcPlatforms.map((p) => ({ key: p.id, label: p.name, sub: p.brief })), currentKey: pfc.id },
    inverter: { title: t('assemblyWorkshop.popSwitchInverter'), options: inverterPlatforms.map((p) => ({ key: p.ipmPartNo, label: `${p.ipmBrand} ${p.ipmPartNo}`, sub: `${p.topology} · ${p.ratedCurrentA}A / ${p.ratedBusV}V · MCU ${p.mcuPartNo}` })), currentKey: inverter.ipmPartNo },
    strategy: { title: t('assemblyWorkshop.popSwitchStrategy'), options: controlStrategies.map((s) => ({ key: s.id, label: s.name, sub: s.brief })), currentKey: strategy.id },
  }[slot];

  return (
    <>
      <div className="absolute inset-0 z-10 cursor-pointer" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label={config.title} className="absolute left-1/2 top-1/2 z-20 max-h-[70%] w-[90%] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-accent-primary/60 bg-bg-raised p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-caption uppercase tracking-[0.18em] text-ink-muted">{config.title}</p>
          <button type="button" onClick={onClose} className="rounded border border-line-subtle bg-bg-base p-0.5 text-ink-muted hover:text-ink-primary" aria-label={t('assemblyWorkshop.closePopoverAria')}>
            <X className="h-3 w-3" />
          </button>
        </div>
        <ul className="space-y-1">
          {config.options.map((opt, i) => {
            const active = opt.key === config.currentKey;
            return (
              <li key={opt.key}>
                <button
                  type="button"
                  onClick={() => onPick(slot, i)}
                  className={`w-full rounded-md border px-2 py-1.5 text-left text-caption transition-colors ${
                    active
                      ? 'border-accent-primary/60 bg-accent-primary/10 text-accent-primary'
                      : 'border-line-subtle bg-bg-surface text-ink-secondary hover:border-accent-primary/40 hover:bg-accent-primary/5'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {active && <CheckCircle2 className="h-3 w-3 text-accent-primary" aria-label={t('assemblyWorkshop.currentSelectedAria')} />}
                    <span className="font-medium text-ink-primary">{opt.label}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-muted">{opt.sub}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
