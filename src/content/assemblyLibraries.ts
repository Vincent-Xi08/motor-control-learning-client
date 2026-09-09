import type { Refrigerant } from '../simulation/engine/types';
import { simulateCycle } from '../simulation/math/vaporCycle';
import { compressorBundles, type CompressorSpec, type InverterPlatform } from './compressorLibrary';

/**
 * 整机搭建工作台数据层 ——
 *
 * 4 个槽位的可选积木：
 *   1) 压缩机（从 compressorLibrary 复用）
 *   2) 变频器平台（从 compressorLibrary 抽出独立列表 + 增加几个常见组合）
 *   3) 控制策略（开环 V/f / FOC+编码器 / FOC+BEMF / FOC+HFI+BEMF 全套 / +弱磁）
 *   4) 工况预案（制冷夏季 / 制冷重载 / 制热典型 / 冰箱标定 / 启动测试）
 *
 * runAssembly：纯函数，给定 4 个积木组合，跑稳态分析返回诊断结果（不做时域积分）。
 */

// ———————————————————— 控制策略库 ————————————————————

export interface ControlStrategy {
  id: string;
  name: string;
  brief: string;
  /** 能支持零速启动（没它就只能他励起转） */
  zeroSpeedStartCapable: boolean;
  /** 支持无感（不需要外置编码器/霍尔） */
  sensorless: boolean;
  /** 支持弱磁（恒功率区扩展） */
  fieldWeakening: boolean;
  /** 调制方案对应的线性区上限 |V|/Vdc：SPWM = 0.5；SVPWM = 0.866 */
  modulationLimitFactor: number;
  /** 推荐 PWM 频率范围 (kHz) */
  pwmKHzMin: number;
  pwmKHzMax: number;
  /** 学员关键术语 — 学完即懂 */
  keywords: string;
}

export const controlStrategies: ControlStrategy[] = [
  {
    id: 'spwm-vf',
    name: 'SPWM 开环 V/f',
    brief: '最简单：固定 V/f 曲线给定电压，无电流闭环、无角度反馈。',
    zeroSpeedStartCapable: true,  // 开环不需要角度，能从 0 起转
    sensorless: true,             // 不需要任何反馈
    fieldWeakening: false,
    modulationLimitFactor: 0.5,   // SPWM 线性区
    pwmKHzMin: 4,
    pwmKHzMax: 8,
    keywords: '低成本风扇 / 排油泵 / 简易工业风机；效率低、动态响应差',
  },
  {
    id: 'foc-encoder',
    name: 'FOC + 编码器',
    brief: '完整 FOC（Clarke + Park + dq PI + SVPWM），角度从增量编码器读取。',
    zeroSpeedStartCapable: true,  // 编码器自带角度，零速可以拿到 0°
    sensorless: false,
    fieldWeakening: true,
    modulationLimitFactor: 0.866, // FOC 用 SVPWM
    pwmKHzMin: 8,
    pwmKHzMax: 16,
    keywords: '伺服 / 高精度负载；压缩机一般不用（编码器在油里容易坏）',
  },
  {
    id: 'foc-bemf',
    name: 'FOC + 反电动势无感',
    brief: 'FOC + 龙伯格观测器 / 滑模 SMO，靠反电动势估算角度。低速 (<10% 额定) 失效。',
    zeroSpeedStartCapable: false, // 反电动势 ∝ ω，零速时观测不到
    sensorless: true,
    fieldWeakening: true,
    modulationLimitFactor: 0.866,
    pwmKHzMin: 5,
    pwmKHzMax: 16,
    keywords: '风机 / 水泵 / 中高速无感场景；不能零速启动，要靠开环爬到能观测的速度',
  },
  {
    id: 'foc-hfi-bemf',
    name: 'FOC + HFI + BEMF（压缩机标配）',
    brief: '零速到低速段用 HFI 凸极注入定角度，转速起来后切到反电动势观测器。',
    zeroSpeedStartCapable: true,
    sensorless: true,
    fieldWeakening: true,
    modulationLimitFactor: 0.866,
    pwmKHzMin: 5,
    pwmKHzMax: 10,
    keywords: '家用空调 / 商用空调压缩机；IPM 凸极比 > 1.2 才有 HFI 解调信号',
  },
];

// ———————————————————— 工况预案库 ————————————————————

export interface LoadCondition {
  id: string;
  name: string;
  brief: string;
  refrigerant: Refrigerant;
  Te: number;
  Tc: number;
  superheatK: number;
  subcoolK: number;
  ambientIndoorC: number;
  ambientOutdoorC: number;
  /** 目标转速 (rpm)，影响"长期能否到目标"的判定 */
  targetRpm: number;
  /** 加速斜坡，影响启动的"软"程度（rpm/s） */
  rampRpmS: number;
}

export const loadConditions: LoadCondition[] = [
  {
    id: 'cooling-summer-typical',
    name: '空调制冷·夏季典型',
    brief: 'GB/ARI 标准制冷工况：室外 35°C / 室内 27°C，T_e≈7°C / T_c≈45°C',
    refrigerant: 'R32',
    Te: 7.2, Tc: 45, superheatK: 5, subcoolK: 3,
    ambientIndoorC: 27, ambientOutdoorC: 35,
    targetRpm: 4500, rampRpmS: 1000,
  },
  {
    id: 'cooling-heatwave',
    name: '空调制冷·极端高温',
    brief: '室外 45°C 严苛工况，T_c 飙升、排气温度风险大',
    refrigerant: 'R32',
    Te: 10, Tc: 56, superheatK: 6, subcoolK: 4,
    ambientIndoorC: 28, ambientOutdoorC: 45,
    targetRpm: 6000, rampRpmS: 1200,
  },
  {
    id: 'heating-typical',
    name: '空调制热·标准工况',
    brief: '冬季制热：室外 2°C / 室内 20°C，T_e≈-5°C / T_c≈42°C',
    refrigerant: 'R32',
    Te: -5, Tc: 42, superheatK: 5, subcoolK: 3,
    ambientIndoorC: 20, ambientOutdoorC: 2,
    targetRpm: 5000, rampRpmS: 1000,
  },
  {
    id: 'fridge-r134a',
    name: '冰箱·R134a 冷冻工况',
    brief: '冷冻室 -18°C / 室温 25°C，T_e≈-23°C / T_c≈38°C',
    refrigerant: 'R134a',
    Te: -23, Tc: 38, superheatK: 5, subcoolK: 3,
    ambientIndoorC: 4, ambientOutdoorC: 25,
    targetRpm: 2800, rampRpmS: 200,
  },
  {
    id: 'startup-stress',
    name: '启动应力测试',
    brief: '快速冲到额定转速，看启动状态机能否撑住',
    refrigerant: 'R32',
    Te: 5, Tc: 50, superheatK: 5, subcoolK: 3,
    ambientIndoorC: 25, ambientOutdoorC: 38,
    targetRpm: 7500, rampRpmS: 2500,
  },
];

// ———————————————————— PFC 前级库 ————————————————————

export interface PfcPlatform {
  id: string;
  name: string;
  brief: string;
  /** 实际母线电压输出 (V) */
  vdcOutput: number;
  /** 输入电流总谐波失真 (%) */
  inputThdPct: number;
  /** 功率因数 */
  pf: number;
  /** 是否要求 GB 17625 谐波认证 */
  meetsHarmonicStandard: boolean;
}

export const pfcPlatforms: PfcPlatform[] = [
  {
    id: 'none',
    name: '无 PFC（整流桥直供）',
    brief: 'D 整流 + 电容直供母线，~300V 含纹波。THD 100%+、PF≈0.6，超 GB 17625 谐波标准。',
    vdcOutput: 300,
    inputThdPct: 110,
    pf: 0.60,
    meetsHarmonicStandard: false,
  },
  {
    id: 'boost-single',
    name: 'Boost 单相 PFC（家用主流）',
    brief: '单相 Boost 升压 + 电压电流双环，~380V 稳压。THD<15%、PF>0.95，满足 GB 17625。',
    vdcOutput: 380,
    inputThdPct: 12,
    pf: 0.96,
    meetsHarmonicStandard: true,
  },
  {
    id: 'vienna-3phase',
    name: 'Vienna 三相 PFC（工业 / 大功率）',
    brief: '三相对称、~600V 母线，THD<5%、PF>0.99。适合 3HP 以上多联机外机。',
    vdcOutput: 600,
    inputThdPct: 4,
    pf: 0.99,
    meetsHarmonicStandard: true,
  },
  {
    id: 'sic-boost',
    name: 'SiC 高频 Boost PFC（高效高密度）',
    brief: 'SiC MOS 100kHz+ 工作，~380V 母线。效率>98.5%、THD<3%。新一代高端家用。',
    vdcOutput: 380,
    inputThdPct: 3,
    pf: 0.99,
    meetsHarmonicStandard: true,
  },
];

// ———————————————————— 液气分离器库 ————————————————————

export interface LiquidSeparator {
  id: string;
  name: string;
  brief: string;
  /** 可承受的最大 rpm 加速斜坡（rpm/s）—— 超过会液击 */
  maxRampRpmS: number;
}

export const liquidSeparators: LiquidSeparator[] = [
  {
    id: 'none',
    name: '无（吸气管直入压缩腔）',
    brief: '最低成本。冷启动 / 低温工况液击风险大，需要严格控制 rpm 斜坡 < 800 rpm/s。',
    maxRampRpmS: 800,
  },
  {
    id: 'standard',
    name: '标准液气分离器（空调标配）',
    brief: '~500ml 容积，分离吸气中的液滴。rpm 斜坡可放宽到 1500 rpm/s。',
    maxRampRpmS: 1500,
  },
  {
    id: 'large-low-temp',
    name: '大容量低温优化型（冷库 / 商用）',
    brief: '~1500ml + 内部回油结构。承受冷启动 rpm 斜坡可达 3000 rpm/s。',
    maxRampRpmS: 3000,
  },
];

// ———————————————————— 变频器平台库（独立） ————————————————————
// 从 compressorBundles 抽出 + 增加一两个工业常见的高功率平台

const fromBundles: InverterPlatform[] = compressorBundles.map((b) => b.inverter);
// 去重（按 ipmPartNo）
const uniqueByPart = new Map<string, InverterPlatform>();
for (const inv of fromBundles) uniqueByPart.set(inv.ipmPartNo, inv);

export const inverterPlatforms: InverterPlatform[] = [
  ...uniqueByPart.values(),
  {
    ipmBrand: 'Infineon',
    ipmPartNo: 'IRSM836 (CIPOS Mini)',
    topology: 'IPM',
    mcuPartNo: 'STM32F302CBT6',
    ratedCurrentA: 20,
    ratedBusV: 600,
    pwmFreqHz: 8000,
    deadTimeUs: 1.5,
    notes: '英飞凌 CIPOS Mini 系列，过流过温保护集成，国产小家电常用。',
  },
  {
    ipmBrand: 'Vincotech',
    ipmPartNo: 'P935-T3F',
    topology: '分立 IGBT + 驱动 IC',
    mcuPartNo: 'TI TMS320F28379D',
    ratedCurrentA: 30,
    ratedBusV: 1200,
    pwmFreqHz: 10000,
    deadTimeUs: 2.0,
    notes: '工业级分立 IGBT + 驱动板方案，2HP 以上多联机外机常用。',
  },
];

// ———————————————————— runAssembly：稳态诊断 ————————————————————

export type Verdict = 'pass' | 'pass-warn' | 'fail';

/** 诊断点稳定标识：UI 按它映射受影响积木块 / 双语文案，禁止用 message 文本匹配 */
export type DiagnosticCode =
  | 'refrigerant-mismatch' | 'refrigerant-ok'
  | 'startup-incapable' | 'saliency-weak' | 'startup-plan-ok'
  | 'inverter-current-short' | 'inverter-current-tight' | 'inverter-current-ok'
  | 'discharge-over' | 'discharge-near' | 'discharge-ok'
  | 'pressure-ratio-over'
  | 'iq-over-rated' | 'iq-tight' | 'iq-ok'
  | 'voltage-over-fw' | 'voltage-over-nofw' | 'voltage-ok'
  | 'ramp-over' | 'ramp-near' | 'ramp-ok'
  | 'pfc-noncompliant' | 'pfc-ok'
  | 'startup-failed' | 'startup-slow' | 'startup-ok'
  | 'transient-flag';

export interface DiagnosticItem {
  level: 'ok' | 'warn' | 'fault';
  /** 稳定标识（受影响积木块映射 / 双语切换的键） */
  code: DiagnosticCode;
  message: string;
  /** 英文消息（en-US 渲染侧使用） */
  messageEn: string;
  /** 关联建议（学员可以去哪个模块复习 / 调） */
  hintModule?: string;
}

export interface AssemblyResult {
  verdict: Verdict;
  /** 一句话总结（中文） */
  summary: string;
  /** 一句话总结（英文，en-US 渲染侧使用） */
  summaryEn: string;
  /** 关键稳态指标 */
  metrics: {
    coolingW: number;          // 实际制冷量 (W)
    inputW: number;            // 输入电功率 (W)
    cop: number;
    Tdischarge: number;        // 排气温度 (°C)
    pressureRatio: number;
    targetRpm: number;
    requiredIqA: number;       // 稳态所需 Iq (A)
    backEmfV: number;          // max rpm 时的反电动势峰值 (V)
    busHeadroomPct: number;    // SVPWM 线性区还剩多少 % 余量
  };
  /** 各项诊断点（pass / warn / fault 都列出） */
  items: DiagnosticItem[];
  /** 时域仿真结果 —— 8s 启动+稳态过程，供 timeline 图绘制 */
  timeline: AssemblyTimeline;
}

export type AssemblyState = 'align' | 'openloop' | 'hfi' | 'bemf' | 'fieldweak' | 'steady';

export interface AssemblySample {
  t: number;        // 秒
  rpm: number;
  rpmRef: number;
  iqA: number;
  busUtil: number;  // 母线利用率 |V|/V_max（>1 = 饱和）
  state: AssemblyState;
  faultActive: boolean;
}

export interface AssemblyTimeline {
  samples: AssemblySample[];
  /** 达到 50% target 的时间（s） */
  rise50PctS: number;
  /** 达到 95% target 的时间（s）—— 没达到记 Infinity */
  settling95PctS: number;
  /** 最终是否真的到了目标转速 */
  reachedTarget: boolean;
  /** 在某个时刻出现过故障 */
  hadFault: boolean;
  /** 状态切换点（用于 timeline 标注） */
  transitions: Array<{ t: number; state: AssemblyState; label: string }>;
}

// 状态机时间常数（秒）
const T_ALIGN = 0.3;
const HFI_HANDOFF_RPM = 200;
const BEMF_HANDOFF_RPM = 600;
const TOTAL_S = 8;
const DT = 0.02;

const STATE_LABEL: Record<AssemblyState, string> = {
  align: '对齐',
  openloop: '开环 V/f',
  hfi: 'HFI 引导',
  bemf: 'BEMF 观测',
  fieldweak: '弱磁',
  steady: '稳态',
};

/**
 * 时域仿真：8 秒启动 + 稳态过程。
 *
 * 状态机推进依据控制策略：
 *   - V/f：align → openloop 全程（targetRpm 即 V/f 直接给）
 *   - FOC + 编码器：align → bemf（标志位复用：编码器有真角度，跳过开环/HFI）
 *   - FOC + BEMF：align → openloop → bemf（开环爬到 BEMF 可观测速度再切）
 *   - FOC + HFI + BEMF：align → openloop → hfi → bemf → 可选 fieldweak
 *
 * 各段斜坡按"工业上常见的爬升时间"近似。Iq 在加速段取 0.9×额定，稳态用 simulateCycle 算的负载 Iq。
 */
function simulateAssembly(
  compressor: CompressorSpec,
  strategy: ControlStrategy,
  load: LoadCondition,
  steadyIq: number,
  fieldweakRpm: number,
  vdcEffective: number,
): AssemblyTimeline {
  const samples: AssemblySample[] = [];
  const transitions: AssemblyTimeline['transitions'] = [];
  const targetRpm = load.targetRpm;
  const Rs = compressor.rsMohm / 1000;
  const lqH = compressor.lqMh / 1000;

  // 决定本次启动的状态序列
  // V/f：始终在 openloop（不切换）
  // FOC+编码器：align → bemf 直接（角度从编码器）
  // FOC+BEMF：align → openloop → bemf
  // FOC+HFI+BEMF：align → openloop → hfi → bemf → (optional fieldweak)
  const seq: AssemblyState[] = strategy.id === 'spwm-vf'
    ? ['align', 'openloop']
    : strategy.id === 'foc-encoder'
      ? ['align', 'bemf']  // 编码器场景复用 bemf 标签（标志"闭环模式"）
      : strategy.id === 'foc-bemf'
        ? ['align', 'openloop', 'bemf']
        : ['align', 'openloop', 'hfi', 'bemf'];

  // 用 ref-style wrapper 防止 TS 把 state 收窄为字面量 'align'（advanceState 外部赋值不会被 TS 看到）
  const stateRef = { current: 'align' as AssemblyState };
  let stateIdx = 0;
  let rpm = 0;
  let hadFault = false;
  let rise50PctS = Infinity;
  let settling95PctS = Infinity;
  transitions.push({ t: 0, state: 'align', label: STATE_LABEL.align });

  const advanceState = (t: number, nextState: AssemblyState) => {
    stateRef.current = nextState;
    transitions.push({ t, state: nextState, label: STATE_LABEL[nextState] });
  };

  for (let t = 0; t <= TOTAL_S + 1e-6; t += DT) {
    const st = stateRef.current;

    // 状态切换条件
    if (st === 'align' && t >= T_ALIGN && stateIdx + 1 < seq.length) {
      stateIdx += 1;
      advanceState(t, seq[stateIdx]);
    } else if (st === 'openloop' && stateIdx + 1 < seq.length) {
      // openloop 把 rpm 爬到下一阶段切换点
      const nextState = seq[stateIdx + 1];
      const targetForState = nextState === 'hfi' ? HFI_HANDOFF_RPM : nextState === 'bemf' ? BEMF_HANDOFF_RPM : targetRpm;
      if (rpm >= targetForState - 5) {
        stateIdx += 1;
        advanceState(t, seq[stateIdx]);
      }
    } else if (st === 'hfi' && rpm >= BEMF_HANDOFF_RPM - 5 && stateIdx + 1 < seq.length) {
      stateIdx += 1;
      advanceState(t, seq[stateIdx]);
    } else if (st === 'bemf' && strategy.fieldWeakening && rpm >= fieldweakRpm - 5) {
      advanceState(t, 'fieldweak');
    }

    const curState = stateRef.current;

    // 各状态下的 rpm 爬升斜率（rpm/s）
    let rampRpmS = 0;
    if (curState === 'align') rampRpmS = 0;
    else if (curState === 'openloop') {
      rampRpmS = load.rampRpmS;
    } else if (curState === 'hfi') {
      rampRpmS = 500;
    } else if (curState === 'bemf') {
      const remaining = targetRpm - rpm;
      rampRpmS = Math.max(200, Math.min(remaining * 1.5, load.rampRpmS));
    } else if (curState === 'fieldweak') {
      rampRpmS = Math.max(50, (targetRpm - rpm) * 1.2);
    }

    // 先推一步 rpm（线性外推），后面再用电压顶限去回压
    rpm = Math.min(targetRpm, rpm + rampRpmS * DT);

    // Iq 估计
    let iqA = 0;
    if (curState === 'align') iqA = compressor.ratedCurrentA * 0.6;
    else if (Math.abs(rpm - targetRpm) > 50) iqA = compressor.ratedCurrentA * 0.85;
    else iqA = steadyIq;

    // 调制方案对应的母线线性区：SPWM 0.5 / SVPWM 0.866。母线电压由 PFC 决定
    const VbusMax = vdcEffective * strategy.modulationLimitFactor;

    // 电压顶限：不弱磁、非 fieldweak 段，rpm 不能超过 ω_max（V_demand = VbusMax 的 ω）
    if (!strategy.fieldWeakening && curState !== 'fieldweak') {
      // 解 V = √((Rs·Iq)² + (ωLq·Iq + ωψ)²) = VbusMax
      // → ω = √(VbusMax² − (Rs·Iq)²) / (Lq·Iq + ψ)
      const inner = VbusMax * VbusMax - Rs * iqA * Rs * iqA;
      if (inner > 0) {
        const omegaMax = Math.sqrt(inner) / Math.max(1e-6, lqH * iqA + compressor.flux);
        const rpmCeil = omegaMax * 60 / (2 * Math.PI * compressor.polePairs);
        rpm = Math.min(rpm, rpmCeil);
      } else {
        // I·R 项已经超过 VbusMax，电流太大顶不住 —— 卡死
        rpm = Math.min(rpm, 0);
      }
    }

    // 母线利用率：|V| / V_max（按当前 strategy 的调制方案 × PFC 实际母线电压）
    const omegaE = (rpm / 60) * 2 * Math.PI * compressor.polePairs;
    const Vd = -omegaE * lqH * iqA;
    const Vq = Rs * iqA + omegaE * compressor.flux;
    const Vmag = Math.hypot(Vd, Vq);
    const busUtil = VbusMax > 0 ? Vmag / VbusMax : 0;

    // 故障检测
    const faultActive = (busUtil > 1.05 && curState !== 'fieldweak') || iqA > compressor.ratedCurrentA * 1.5;
    if (faultActive) hadFault = true;

    if (rise50PctS === Infinity && rpm >= targetRpm * 0.5) rise50PctS = t;
    if (settling95PctS === Infinity && rpm >= targetRpm * 0.95) settling95PctS = t;

    samples.push({ t, rpm, rpmRef: targetRpm, iqA, busUtil, state: curState, faultActive });
  }

  const reachedTarget = rpm >= targetRpm * 0.95;
  return { samples, rise50PctS, settling95PctS, reachedTarget, hadFault, transitions };
}

const TDISCHARGE_LIMIT_C: Record<Refrigerant, number> = { R32: 105, R410A: 110, R134a: 95 };
const PRESSURE_RATIO_LIMIT: Record<Refrigerant, number> = { R32: 7, R410A: 7, R134a: 8 };

export function runAssembly(opts: {
  compressor: CompressorSpec;
  inverter: InverterPlatform;
  strategy: ControlStrategy;
  load: LoadCondition;
  /** 可选：PFC 前级。不提供时按"无 PFC"（vdc=300）兜底 */
  pfc?: PfcPlatform;
  /** 可选：液气分离器。不提供时按"无"（max ramp 800 rpm/s）兜底 */
  separator?: LiquidSeparator;
}): AssemblyResult {
  const { compressor, inverter, strategy, load } = opts;
  // 默认按"家用主流"配置：Boost 单相 PFC + 标准液气分离器（不传时不应让用户挂在不合规上）
  const pfc = opts.pfc ?? pfcPlatforms.find((p) => p.id === 'boost-single') ?? pfcPlatforms[1];
  const separator = opts.separator ?? liquidSeparators.find((s) => s.id === 'standard') ?? liquidSeparators[1];
  const vdcEffective = pfc.vdcOutput;
  const items: DiagnosticItem[] = [];
  /** 诊断条目构造：强制 code + 双语消息，保证 EN 渲染与积木块映射不靠文本匹配 */
  const push = (
    code: DiagnosticItem['code'],
    level: DiagnosticItem['level'],
    message: string,
    messageEn: string,
    hintModule?: string,
  ): void => {
    items.push({ code, level, message, messageEn, hintModule });
  };

  // 1) 冷媒匹配
  if (compressor.refrigerant !== load.refrigerant) {
    push('refrigerant-mismatch', 'fault',
      `冷媒不匹配：压缩机标定 ${compressor.refrigerant}，工况要求 ${load.refrigerant}（压力/排气特性差异巨大，强制运行会损坏压缩机）`,
      `Refrigerant mismatch: compressor calibrated for ${compressor.refrigerant}, load requires ${load.refrigerant} (pressure/discharge characteristics differ drastically — forced operation will damage the compressor)`,
      '16 制冷台架');
  } else {
    push('refrigerant-ok', 'ok', `冷媒匹配 ${compressor.refrigerant}`, `Refrigerant matches: ${compressor.refrigerant}`);
  }

  // 2) 启动可行性：HFI / BEMF 与 targetRpm 的匹配
  if (!strategy.zeroSpeedStartCapable && load.targetRpm > 0) {
    push('startup-incapable', 'fault',
      `控制策略「${strategy.name}」无法零速启动，必须叠开环 V/f 段先拉到能观测的速度（典型 200-500 rpm）`,
      `Control strategy "${strategy.name}" cannot start from zero speed — an open-loop V/f stage is required first to reach an observable speed (typically 200-500 rpm)`,
      '14 启动状态机');
  } else if (strategy.id === 'foc-hfi-bemf' && (compressor.lqMh / compressor.ldMh) < 1.2) {
    push('saliency-weak', 'warn',
      `HFI 需要凸极比 Lq/Ld > 1.2，当前压缩机凸极比 ${(compressor.lqMh / compressor.ldMh).toFixed(2)}，解调信号弱、易丢角度`,
      `HFI needs saliency ratio Lq/Ld > 1.2; this compressor's ratio is ${(compressor.lqMh / compressor.ldMh).toFixed(2)} — weak demodulation signal, angle loss likely`,
      '13 HFI 无感');
  } else {
    push('startup-plan-ok', 'ok', `启动方案与压缩机匹配（${strategy.name}）`, `Startup plan matches the compressor (${strategy.name})`);
  }

  // 3) 电流余量：逆变器额定电流 vs 压缩机额定电流（1.5x 经验值用于过载冲击）
  const currentMarginRatio = inverter.ratedCurrentA / compressor.ratedCurrentA;
  if (currentMarginRatio < 1.5) {
    push('inverter-current-short', 'fault',
      `逆变器额定 ${inverter.ratedCurrentA}A < 压缩机额定 ${compressor.ratedCurrentA}A × 1.5（启动冲击会触发 OCP）`,
      `Inverter rated ${inverter.ratedCurrentA}A < compressor rated ${compressor.ratedCurrentA}A × 1.5 (start-up surge will trip OCP)`,
      '08 三相逆变器');
  } else if (currentMarginRatio < 2.0) {
    push('inverter-current-tight', 'warn',
      `逆变器电流余量偏小（${currentMarginRatio.toFixed(1)}×），高温重载工况下接近上限`,
      `Inverter current margin is tight (${currentMarginRatio.toFixed(1)}×) — close to the limit under hot, heavy load`,
      '08 三相逆变器');
  } else {
    push('inverter-current-ok', 'ok', `逆变器电流余量充足（${currentMarginRatio.toFixed(1)}×）`, `Inverter current margin is ample (${currentMarginRatio.toFixed(1)}×)`);
  }

  // 4) 跑稳态制冷循环
  const cycle = simulateCycle({
    refrigerant: compressor.refrigerant,
    Te: load.Te,
    Tc: load.Tc,
    superheatK: load.superheatK,
    subcoolK: load.subcoolK,
    displacementCc: compressor.displacementCc,
    clearanceRatio: 0.05,
    rpm: load.targetRpm,
    isentropicEff: 0.72,
    eevOpening: 0.55,
  });

  // 5) 排气温度
  const tdLimit = TDISCHARGE_LIMIT_C[compressor.refrigerant];
  if (cycle.Tdischarge > tdLimit) {
    push('discharge-over', 'fault',
      `排气温度 ${cycle.Tdischarge.toFixed(1)}°C 超过 ${compressor.refrigerant} 限值 ${tdLimit}°C（润滑油氧化、阀片烧蚀风险）`,
      `Discharge temperature ${cycle.Tdischarge.toFixed(1)}°C exceeds the ${compressor.refrigerant} limit of ${tdLimit}°C (oil oxidation, valve burn risk)`,
      '16 制冷台架');
  } else if (cycle.Tdischarge > tdLimit - 15) {
    push('discharge-near', 'warn',
      `排气温度 ${cycle.Tdischarge.toFixed(1)}°C 接近限值（${tdLimit}°C），高负载长期运行需监控`,
      `Discharge temperature ${cycle.Tdischarge.toFixed(1)}°C is near the limit (${tdLimit}°C) — monitor under sustained high load`,
    );
  } else {
    push('discharge-ok', 'ok', `排气温度 ${cycle.Tdischarge.toFixed(1)}°C 安全`, `Discharge temperature ${cycle.Tdischarge.toFixed(1)}°C is safe`);
  }

  // 6) 压比
  const prLimit = PRESSURE_RATIO_LIMIT[compressor.refrigerant];
  if (cycle.pressureRatio > prLimit) {
    push('pressure-ratio-over', 'fault',
      `压比 ${cycle.pressureRatio.toFixed(2)} 超过 ${prLimit}（压缩机超工况运行）`,
      `Pressure ratio ${cycle.pressureRatio.toFixed(2)} exceeds ${prLimit} (compressor running beyond its envelope)`,
      '16 制冷台架');
  }

  // 7) Iq 需求 vs 额定
  const torqueLoad = cycle.torqueLoad;
  const requiredIq = torqueLoad / (1.5 * compressor.polePairs * compressor.flux);
  if (requiredIq > compressor.ratedCurrentA) {
    push('iq-over-rated', 'fault',
      `需求 Iq ${requiredIq.toFixed(2)}A > 压缩机额定 ${compressor.ratedCurrentA}A（长期会烧绕组）`,
      `Required Iq ${requiredIq.toFixed(2)}A > compressor rated ${compressor.ratedCurrentA}A (windings will burn out over time)`,
      '11 弱磁');
  } else if (requiredIq > compressor.ratedCurrentA * 0.85) {
    push('iq-tight', 'warn',
      `需求 Iq ${requiredIq.toFixed(2)}A 占额定 ${(requiredIq / compressor.ratedCurrentA * 100).toFixed(0)}%，余量小`,
      `Required Iq ${requiredIq.toFixed(2)}A is ${(requiredIq / compressor.ratedCurrentA * 100).toFixed(0)}% of rating — little headroom`,
    );
  } else {
    push('iq-ok', 'ok', `稳态 Iq ${requiredIq.toFixed(2)}A，占额定 ${(requiredIq / compressor.ratedCurrentA * 100).toFixed(0)}%`, `Steady-state Iq ${requiredIq.toFixed(2)}A — ${(requiredIq / compressor.ratedCurrentA * 100).toFixed(0)}% of rating`);
  }

  // 8) 反电动势 vs 母线电压（弱磁能力 / SVPWM 线性区）
  const omegaE = (load.targetRpm / 60) * 2 * Math.PI * compressor.polePairs; // 电角速度 rad/s
  const backEmfPeak = omegaE * compressor.flux;              // 永磁体反电动势峰值 (V)
  // 电流电压方程 |V| ≈ √( (Rs*Iq)² + (ωL*Iq + ωψ)² )
  const Rs = compressor.rsMohm / 1000;
  const ldH = compressor.ldMh / 1000;
  const lqH = compressor.lqMh / 1000;
  const Vd = -omegaE * lqH * requiredIq;
  const Vq = Rs * requiredIq + omegaE * compressor.flux;     // Id=0 假设
  void ldH; // 暂未用到 Ld（Id=0 假设）
  const Vmag = Math.hypot(Vd, Vq);
  // 按当前 strategy 的调制限 × PFC 实际母线
  const VbusMax = vdcEffective * strategy.modulationLimitFactor;
  const busHeadroomPct = (1 - Vmag / VbusMax) * 100;
  const modLabel = strategy.modulationLimitFactor === 0.5 ? 'SPWM' : 'SVPWM';

  if (Vmag > VbusMax) {
    if (strategy.fieldWeakening) {
      push('voltage-over-fw', 'warn',
        `需求电压 ${Vmag.toFixed(1)}V > 母线线性区 ${VbusMax.toFixed(1)}V（${modLabel} @ ${vdcEffective}V 母线），弱磁可注入负 Id 扩展恒功率区`,
        `Required voltage ${Vmag.toFixed(1)}V > bus linear region ${VbusMax.toFixed(1)}V (${modLabel} @ ${vdcEffective}V bus) — field weakening can inject negative Id to extend the constant-power region`,
        '11 弱磁');
    } else {
      push('voltage-over-nofw', 'fault',
        `需求电压 ${Vmag.toFixed(1)}V > 母线线性区 ${VbusMax.toFixed(1)}V（${modLabel} @ ${vdcEffective}V 母线），但控制策略不支持弱磁 → 无法到目标转速`,
        `Required voltage ${Vmag.toFixed(1)}V > bus linear region ${VbusMax.toFixed(1)}V (${modLabel} @ ${vdcEffective}V bus), but the strategy has no field weakening → target speed unreachable`,
        '11 弱磁');
    }
  } else {
    push('voltage-ok', 'ok',
      `电压利用率 ${(Vmag / VbusMax * 100).toFixed(0)}%，余量 ${busHeadroomPct.toFixed(0)}%（${modLabel} @ ${vdcEffective}V）`,
      `Voltage utilization ${(Vmag / VbusMax * 100).toFixed(0)}%, headroom ${busHeadroomPct.toFixed(0)}% (${modLabel} @ ${vdcEffective}V)`);
  }

  // 9) 加速斜坡 vs 液气分离器承载力
  if (load.rampRpmS > separator.maxRampRpmS) {
    push('ramp-over', 'fault',
      `工况加速斜坡 ${load.rampRpmS} rpm/s 超过${separator.name}承载 ${separator.maxRampRpmS} rpm/s — 液击会撞坏阀片与曲轴`,
      `Load acceleration ramp ${load.rampRpmS} rpm/s exceeds the ${separator.name} capacity of ${separator.maxRampRpmS} rpm/s — slugging will damage valves and crankshaft`,
      '14 启动状态机');
  } else if (load.rampRpmS > separator.maxRampRpmS * 0.8) {
    push('ramp-near', 'warn',
      `加速斜坡 ${load.rampRpmS} rpm/s 接近${separator.name}上限 ${separator.maxRampRpmS}，留余量更稳妥`,
      `Acceleration ramp ${load.rampRpmS} rpm/s is near the ${separator.name} limit of ${separator.maxRampRpmS} — keep more margin`,
    );
  } else {
    push('ramp-ok', 'ok', `加速斜坡 ${load.rampRpmS} rpm/s 在${separator.name}承载范围内`, `Acceleration ramp ${load.rampRpmS} rpm/s is within ${separator.name} capacity`);
  }

  // 9b) PFC 谐波 / 功率因数
  if (!pfc.meetsHarmonicStandard) {
    push('pfc-noncompliant', 'fault',
      `${pfc.name}：THD ${pfc.inputThdPct}% / PF ${pfc.pf} — 不满足 GB 17625.1 谐波认证，不能合规出厂`,
      `${pfc.name}: THD ${pfc.inputThdPct}% / PF ${pfc.pf} — fails GB 17625.1 harmonic compliance, cannot ship certified`,
      '15 APF 前级 PFC');
  } else {
    push('pfc-ok', 'ok', `${pfc.name}：THD ${pfc.inputThdPct}% / PF ${pfc.pf}，符合谐波合规`, `${pfc.name}: THD ${pfc.inputThdPct}% / PF ${pfc.pf} — harmonics compliant`);
  }

  // 10) 时域仿真：8s 启动 + 稳态过程
  const fieldweakRpm = load.targetRpm * 0.85;
  const timeline = simulateAssembly(compressor, strategy, load, requiredIq, fieldweakRpm, vdcEffective);

  // 11) 启动结果反馈到诊断
  if (!timeline.reachedTarget) {
    push('startup-failed', 'fault',
      `8 秒仿真内未达到目标转速 ${load.targetRpm} rpm（启动失败 / 策略与压缩机不匹配）`,
      `Target speed ${load.targetRpm} rpm not reached within the 8 s simulation (start-up failed / strategy-compressor mismatch)`,
      '14 启动状态机');
  } else if (timeline.settling95PctS > 5) {
    push('startup-slow', 'warn',
      `稳态收敛时间 ${timeline.settling95PctS.toFixed(1)} s > 5 s，启动偏慢`,
      `Settling time ${timeline.settling95PctS.toFixed(1)} s > 5 s — start-up is slow`,
      '14 启动状态机');
  } else {
    push('startup-ok', 'ok',
      `启动正常：50% 用时 ${timeline.rise50PctS.toFixed(2)} s · 95% 收敛 ${timeline.settling95PctS.toFixed(2)} s`,
      `Start-up normal: 50% at ${timeline.rise50PctS.toFixed(2)} s · 95% settled at ${timeline.settling95PctS.toFixed(2)} s`,
    );
  }
  if (timeline.hadFault) {
    push('transient-flag', 'warn',
      '启动过程中曾出现过流/电压饱和瞬态故障旗（时间线已标红）',
      'Over-current / voltage-saturation transient flags appeared during start-up (marked red on the timeline)',
    );
  }

  // 综合判定
  const hasFault = items.some((i) => i.level === 'fault');
  const hasWarn = items.some((i) => i.level === 'warn');
  const verdict: Verdict = hasFault ? 'fail' : hasWarn ? 'pass-warn' : 'pass';
  const summary = hasFault
    ? '整机无法通过：存在阻断性问题'
    : hasWarn
      ? '整机可运行：存在告警但不阻断'
      : '整机全绿，可投运';
  const summaryEn = hasFault
    ? 'System blocked: a blocking issue is present'
    : hasWarn
      ? 'System operable: warnings present but non-blocking'
      : 'All checks green, ready for deployment';

  const inputW = cycle.Wcomp * 1000;
  const coolingW = cycle.Qc * 1000;

  return {
    verdict,
    summary,
    summaryEn,
    metrics: {
      coolingW,
      inputW,
      cop: cycle.cop,
      Tdischarge: cycle.Tdischarge,
      pressureRatio: cycle.pressureRatio,
      targetRpm: load.targetRpm,
      requiredIqA: requiredIq,
      backEmfV: backEmfPeak,
      busHeadroomPct,
    },
    items,
    timeline,
  };
}
