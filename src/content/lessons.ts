import type { ModuleId } from '../simulation/engine/types';
import type { Locale } from '../i18n/types';
import { useI18nStore } from '../store/i18nStore';

/**
 * 英文讲义惰性注册表。
 *
 * lessonsEn.ts 约 157 kB 源码（压缩后 ~120 kB），若静态 import 会被打进
 * 首屏主包——中文用户永远用不到，英文用户也只是讲义区用。改为：
 *   - 本模块内维护可变注册表，getLesson / getFallbackLanguage 同步读取
 *     （数据未到达时回退中文，语义安全）；
 *   - `ensureLessonsEn()` 动态 import 填充并返回 Promise（幂等）；
 *   - UI 层在 locale 切到 en-US 时调用并等待重渲染（见 ConceptNotes）。
 * 这样 lessonsEn 进入独立 chunk，只被真正需要的人下载。
 */
let lessonsEn: Partial<Record<ModuleId, LessonContent>> = {};
let lessonsEnPromise: Promise<void> | null = null;

export function ensureLessonsEn(): Promise<void> {
  if (!lessonsEnPromise) {
    lessonsEnPromise = import('./lessonsEn').then((m) => {
      lessonsEn = m.lessonsEn;
    });
  }
  return lessonsEnPromise;
}

/** 该模块是否存在英文讲义（ensureLessonsEn 完成后才是准确值）。 */
export function hasEnLesson(id: ModuleId): boolean {
  return Boolean(lessonsEn[id]);
}

export interface LessonContent {
  id: ModuleId;
  learningGoals: string[];
  concepts: string[];
  formulas: Array<{ title: string; expression: string; explanation: string }>;
  engineeringMeaning: string[];
  stm32Guide: string[];
  commonMistakes: string[];
  debugMethods: string[];
  experiments: string[];
  summary: string;
  nextSteps: string[];
  codeExample: string;
  /** 零基础读者第一段：用类比 / 一句话核心 / 为什么学 / 第一手交互建议 */
  introBeginner?: {
    metaphor: string;
    coreIdea: string;
    whyCare: string[];
    firstAction: string;
  };
  /** 随堂题：3-5 道单选，做完才进入下一模块 */
  quiz?: Array<{
    q: string;
    options: string[];
    correct: number;
    hint: string;
  }>;
}

export const lessons: Partial<Record<ModuleId, LessonContent>> = {
  'motor-basics': {
    id: 'motor-basics',
    introBeginner: {
      metaphor: '电机就像一群推秋千的人——定子绕组通电后产生磁极（"手"），转子带着永磁体（"秋千"）被周期性地往同一个方向推。FOC 要解决的核心问题就是"什么时候推、推多大力"，让秋千越荡越快、越荡越稳。',
      coreIdea: 'FOC 控制的所有数学，都建立在"机械角度 → 乘极对数 → 电角度 → 控制磁场方向"这条最基础的链条上。',
      whyCare: [
        '极对数搞错，电角度就会差几倍，电机会抖动甚至反转——是 FOC 上电就转不动的最常见原因。',
        '机械角度（你眼睛看到转子转的角度）和电角度（控制器算法用的角度）是两个量，不能混用。',
        '后面所有模块（Clarke / Park / SVPWM / 弱磁）都以"我此刻知道电角度是多少"为前提。',
      ],
      firstAction: '右侧把"极对数"从 4 改到 8，看右边两个圆环：机械角度 θm 不变（45°），电角度 θe 跳到 360°——8 极对电机，机械转一圈，电角度要循环 8 圈。',
    },
    learningGoals: ['区分 DC、BLDC、PMSM、异步电机的控制差异', '理解定子、转子、永磁体、绕组、霍尔和编码器的作用', '掌握机械角度、电角度、极对数之间的关系'],
    concepts: ['机械角度是转子实体转过的角度，电角度是磁场周期对应的角度。极对数越多，转子一圈内电角度转得越多。', 'PMSM 的转矩主要来自 q 轴电流，d 轴通常对准永磁体磁链；表贴式电机常用 Id=0，内嵌式电机还会用 MTPA。', '反电动势与转速、磁链相关，速度越高，控制器需要的电压余量越大。'],
    formulas: [
      { title: '电角度', expression: 'θe = polePairs × θm', explanation: 'θm 是机械角度（编码器实际读到的值），polePairs 是极对数。控制算法用的是 θe，这是 FOC 第一行代码。' },
      { title: '电频率', expression: 'fe = (rpm / 60) × polePairs', explanation: '机械 1500 rpm 的 4 极对电机，电频率 = 25 × 4 = 100 Hz。这个值决定 PWM 频率应该至少是它的几十倍。' },
      { title: '电磁转矩', expression: 'Te = 1.5 × p × (ψf × Iq + (Ld - Lq) × Id × Iq)', explanation: 'p 为极对数，ψf 为永磁体磁链；表贴式电机 Ld=Lq，转矩近似 Te ≈ 1.5 × p × ψf × Iq，与 Iq 成正比。这是为什么 q 轴叫"转矩轴"。' },
      { title: '反电动势', expression: 'BEMF = Ke × ω', explanation: '转速越高反电动势越大；当 BEMF 接近母线电压时，控制器没电压余量了，就需要弱磁。' },
    ],
    engineeringMeaning: [
      '调试 FOC 第一件事是确认极对数（Datasheet 或者拆机数齿）。错了所有 dq 都错。',
      'Rs / Ld / Lq / Ke / Kt / J / B 这 7 个参数决定电流环带宽和观测器精度。买电机时尽量要齐。',
      '机械角度反馈精度（编码器分辨率 ÷ 极对数）决定了电流环最大 dq 误差。低分辨率 + 高极对数 = 大误差。',
    ],
    stm32Guide: [
      '编码器或霍尔读到 θm（机械），用 (uint16_t)((theta_raw * polePairs) % ENCODER_RESOLUTION) 得到 θe。',
      '初始化阶段必须做"对齐"——给定一个已知 dq 电压，让转子停在 d 轴零位，再清编码器零点。',
      '极对数、Rs、Ls、Ke 放在 motor_param_t 结构体里，从 Flash 加载，方便切换电机不重新编译。',
    ],
    commonMistakes: ['直接把机械角度送进 Park（电机会抖动或不转）。', '极对数填成"极数"——8 极电机的极对数是 4，不是 8。', '没做编码器零位对齐就直接闭环。', '混用相电流（Ia）、线电流（Iab）、dq 电流的单位和缩放。'],
    debugMethods: ['空载、低母线电压（先 12V）下手动给 Iq=1A、θe 缓慢累加，看转子能不能跟住。', '在 SWO/RTT/串口里每 PWM 周期记录 θm 和 θe，正常应该 θe 跑得比 θm 快 polePairs 倍。', '示波器抓三相电流，应该是 120° 相差的对称正弦。'],
    experiments: ['极对数 4 → 8，机械角度不变，看电角度循环数变化。', '机械转速 0 → 6000 rpm，看电频率随之变化（公式 fe = rpm × p / 60）。'],
    summary: '"机械 → 电角度"的乘极对数是 FOC 第一公里。后面所有模块默认你已经会算电角度。',
    nextSteps: ['进入三相磁场模块，看三相电流怎么合成出一个真正会转的磁场——这是为什么把电角度算对就能控住电机。'],
    codeExample: `/* ============================================
 * motor.h — 电机参数与角度计算
 * 适配 STM32F4/G4/H7，PWM 中心对齐 16kHz
 * ============================================ */
typedef struct {
    uint8_t  pole_pairs;     // 极对数（不是极数）
    float    rs;             // 相电阻 Ω
    float    ld_h;           // d 轴电感 H
    float    lq_h;           // q 轴电感 H
    float    psi_f;          // 永磁磁链 Wb
    float    rated_current;  // 额定电流 A
} motor_param_t;

/* 编码器原始值 → 电角度（rad）
 * encoder_raw: 0 ~ ENCODER_RESOLUTION-1
 * encoder_zero: 启动时对齐得到的零位偏置 */
static inline float encoder_to_theta_e(
    uint32_t encoder_raw,
    uint32_t encoder_zero,
    uint8_t  pole_pairs)
{
    /* 1. 减零位偏置，得到机械角度计数 */
    int32_t mech = (int32_t)encoder_raw - (int32_t)encoder_zero;
    if (mech < 0) mech += ENCODER_RESOLUTION;

    /* 2. 乘极对数 → 电角度计数（防溢出） */
    uint32_t elec = ((uint32_t)mech * pole_pairs) % ENCODER_RESOLUTION;

    /* 3. 归一化到 [0, 2π) */
    return (float)elec * (2.0f * M_PI / ENCODER_RESOLUTION);
}

/* 在 ADC 中断的最开头调用，整个 FOC 链的起点 */
volatile float g_theta_e;
void ADC_IRQHandler_Begin(void) {
    g_theta_e = encoder_to_theta_e(
        ENCODER_GetCount(),
        g_param.encoder_zero,
        g_param.pole_pairs);
    /* 之后是 Clarke → Park → PI → 反 Park → SVPWM */
}`,
    quiz: [
      {
        q: '一台铭牌写"8 极、4 对极"的 PMSM，FOC 中应该用极对数等于多少？',
        options: ['8', '4', '16', '2'],
        correct: 1,
        hint: '"极"指磁极总数（N+S 都数），"对极"=极/2。FOC 算法用极对数，本题为 4。',
      },
      {
        q: '4 极对电机以 1500 rpm 转动，电频率是多少？',
        options: ['25 Hz', '50 Hz', '100 Hz', '6000 Hz'],
        correct: 2,
        hint: 'fe = rpm/60 × polePairs = 25 × 4 = 100 Hz。PWM 频率应至少是它的 50 倍以上。',
      },
      {
        q: '若把机械角度 θm 直接当成 θe 送进 Park 变换，最可能出现什么现象？',
        options: ['电机正常转动只是慢一点', '电机抖动或不转', '电流变小', '没影响，FOC 自动纠正'],
        correct: 1,
        hint: 'θe 应是 θm × 极对数。差了几倍后 dq 投影完全错位，Iq 实际投到 Id 上，几乎产生不了转矩。',
      },
      {
        q: '表贴式 PMSM (Ld=Lq) 在 Id=0 控制下，电磁转矩主要由什么决定？',
        options: ['Id', 'Iq', '母线电压', 'PWM 频率'],
        correct: 1,
        hint: 'Te = 1.5p(ψf·Iq + (Ld-Lq)IdIq)。Ld=Lq 时第二项为 0，Iq 直接等比例决定转矩。',
      },
      {
        q: '为什么 FOC 启动前必须做"编码器零位对齐"？',
        options: ['硬件要求', '让控制器知道 d 轴在哪里，才能正确算 dq 投影', '保护编码器', '减少 PWM 噪声'],
        correct: 1,
        hint: 'd 轴沿转子永磁体 N 极，对齐就是把"编码器读数 = 0"和"d 轴指向定子 A 相"绑在一起。不对齐会导致 Id/Iq 命令与实际方向有恒定偏差。',
      },
    ],
  },
  'three-phase': {
    id: 'three-phase',
    introBeginner: {
      metaphor: '三相电流就像三个排成 120° 的人**轮流**推一个旋转门——任何时刻总有人在推，门就一直转。三个人发力大小是正弦曲线，相互错开 120°，合起来给门一个**幅值不变方向连续转动**的力。这个"力"就是定子合成磁场。',
      coreIdea: '三个固定方向的绕组通入相位差 120° 的正弦电流，合成出一个像转子一样转动的磁场——这是所有 AC 电机能转起来的物理基础。',
      whyCare: [
        '不理解"三相→旋转磁场"，后面 Clarke / Park 的几何意义全是数字游戏。',
        '调试时三相不平衡是最常见故障源（采样偏置、缺相、相序错），看波形和合成矢量就能一眼诊断。',
        '把"3 相 AC"变成"2 维矢量"是从硬件视角到 FOC 控制视角的关键转换。',
      ],
      firstAction: '把右侧"频率"从 50 Hz 拉到 120 Hz，看左侧定子截面的合成磁场箭头转得明显变快；底部三相波形周期变短。然后试试"三相不平衡"=0.3，看箭头轨迹从圆变成椭圆。',
    },
    learningGoals: ['理解三相相差 120° 的正弦电流', '观察合成磁场矢量为何匀速旋转', '理解幅值、频率、相位、不平衡、谐波和噪声对磁场的影响'],
    concepts: ['理想三相电流满足 Ia + Ib + Ic = 0，三相在空间上也相差 120°，合成后形成幅值稳定的旋转磁场。', '频率决定磁场旋转速度，幅值决定磁场强度，初始相位决定当前时刻磁场从哪里开始。', '不平衡、谐波和采样噪声会让合成矢量变成椭圆、抖动或带纹波。'],
    formulas: [
      { title: '三相正弦电流', expression: 'Ia = I·sin(ωt),  Ib = I·sin(ωt − 2π/3),  Ic = I·sin(ωt + 2π/3)', explanation: 'I 是峰值，ω = 2πf；三相和恒为 0（平衡时）。' },
      { title: '合成磁动势', expression: 'F(t) = (3/2)·I·e^(jωt)', explanation: '空间相差 120° 的三个绕组 + 时间相差 120° 的三相电流 → 幅值稳定 (3/2)I 的旋转复矢量。' },
      { title: '电频率 vs 同步转速', expression: 'n_s = 60·f / p', explanation: '50 Hz 4 极对电机 → 同步转速 750 rpm。FOC 中 f 由控制器选定，决定电机要追的目标转速。' },
    ],
    engineeringMeaning: ['FOC 的所有坐标变换都建立在三相正弦量之上。先把波形和旋转磁场看懂，后面的 αβ、dq 才不抽象。', '真实驱动器三相不平衡常来自电流采样偏置、相电阻差异、死区、相序错或 PWM 更新时序错。'],
    stm32Guide: ['ADC 采样与 PWM 中点同步（注入采样 + 中心对齐 PWM）以避开开关噪声。', '上电后第一件事是 ADC 偏置校准：电机不通电时记录 ia/ib/ic 数百次取均值作为零点。', '调试用开环 V/f 或开环正弦电流模式，低压（12V）观察三相波形对称性，再切闭环。'],
    commonMistakes: ['只看单相电流，忽略三相相位关系。', '采样点靠近 PWM 边沿，开关纹波直接进控制环。', 'RMS / 峰值 / 平均值混用导致标定比例错。', 'ADC 偏置没校准就上电流环。'],
    debugMethods: ['示波器/电流钳比较三相峰值和相位关系（应严格 120° 差）。', '运行时记录 ia+ib+ic：平衡系统应 < 0.1A；偏移大就是采样偏置或缺相。', '把 ia/ib/ic 送进 FFT，谐波 > 5% 检查死区和反电动势谐波。'],
    experiments: ['频率 50→120 Hz，看磁场旋转加快（同振幅）。', '注入 5 次谐波，看波形顶部出现凹坑、αβ 轨迹出现波纹。', '不平衡 = 0.3，看圆形轨迹塌成椭圆。'],
    summary: '三相正弦的核心不是 sin 公式，而是"相位差 120° 的三个量在空间相差 120° 的绕组里合成出一个旋转磁场"。',
    nextSteps: ['进入 Clarke 变换，把三相量压缩成二维 αβ 平面矢量——这是 FOC 第一步坐标变换。'],
    codeExample: `/* ============================================
 * 三相 ADC 采样 + 偏置校准
 * 适配 STM32 ADC + DMA + 注入序列触发
 * ============================================ */

/* 上电校准：电机不通电时取 1024 次平均，记录零电流 ADC 值 */
typedef struct {
    int32_t ia_offset;   // ADC 原始码值
    int32_t ib_offset;
    int32_t ic_offset;
    float   adc_to_amps; // 转换系数 = Vref / (4096 × R_shunt × Gain)
} current_calib_t;

void current_calibrate(current_calib_t *c) {
    int32_t sa = 0, sb = 0, sc = 0;
    for (int i = 0; i < 1024; i++) {
        while (!(ADC1->JSR & ADC_JSR_JEOC)) { /* 等注入完成 */ }
        sa += ADC1->JDR1;
        sb += ADC1->JDR2;
        sc += ADC1->JDR3;
        ADC1->JSR &= ~ADC_JSR_JEOC;
    }
    c->ia_offset = sa >> 10;   // /1024
    c->ib_offset = sb >> 10;
    c->ic_offset = sc >> 10;
}

/* 中断中：原始码值 → 真实安培 */
static inline float adc_to_amps(int32_t raw, int32_t offset, float scale) {
    return (float)(raw - offset) * scale;
}

/* 用法（在 FOC ISR 里）：
 *   float ia = adc_to_amps(ADC1->JDR1, calib.ia_offset, calib.adc_to_amps);
 *   float ib = adc_to_amps(ADC1->JDR2, calib.ib_offset, calib.adc_to_amps);
 *   float ic = -ia - ib;   // 三相和=0 重构第三相，省一路 ADC
 *   // 调试断言：fabsf(ia + ib + ic) 应该 < 0.1A
 */`,
    quiz: [
      {
        q: '三相平衡正弦电流 Ia + Ib + Ic 理论值是多少？',
        options: ['正比于幅值 I', '正比于频率 f', '恒为 0', '随 ωt 变化'],
        correct: 2,
        hint: 'sin(ωt) + sin(ωt − 2π/3) + sin(ωt + 2π/3) = 0 是恒等式。运行时若 |Ia+Ib+Ic| > 0.1A 多半是 ADC 偏置没校准。',
      },
      {
        q: '三相电流频率从 50Hz 调到 120Hz，定子合成磁场会怎样？',
        options: ['幅值变大', '幅值不变、转得更快', '消失', '反向'],
        correct: 1,
        hint: '幅值取决于电流峰值，频率只决定旋转角速度 ω = 2πf。',
      },
      {
        q: '示波器看到三相幅值各 6A 但只有两相相差 120°，第三相相差 100°，会发生什么？',
        options: ['和正常一样', '合成磁场幅值不稳定，轨迹变椭圆', '电机停转', 'PWM 频率改变'],
        correct: 1,
        hint: '相位失配让三相不再对称合成出圆形旋转磁场，αβ 矢量端点画椭圆/抖动。',
      },
      {
        q: 'STM32 ADC 采样三相电流时为什么强烈推荐放在 PWM 中点？',
        options: ['硬件要求', '中点是开关边沿，电流变化最快', '中点电流纹波最小，避开开关噪声', '只能这样接线'],
        correct: 2,
        hint: '中心对齐 PWM 中点是上下管已经稳定切换完成的位置，电流纹波接近平均值，靠近开关边沿采样会引入巨大噪声。',
      },
      {
        q: '4 极对 PMSM，定子电流频率 100Hz，电机的同步机械转速是？',
        options: ['100 rpm', '1500 rpm', '6000 rpm', '400 rpm'],
        correct: 1,
        hint: 'n_s = 60·f / p = 60 × 100 / 4 = 1500 rpm。',
      },
    ],
  },
  'clarke-transform': {
    id: 'clarke-transform',
    introBeginner: {
      metaphor: 'Clarke 变换就像把三个箭头**投影**到一面墙上。三相电流 Ia/Ib/Ic 是三个空间相差 120° 的矢量，它们的合力只有两个独立自由度（因为 Ia+Ib+Ic=0），所以画一个 X-Y 平面就够。Clarke 把"三个箭头"压缩成"X 轴的 Iα + Y 轴的 Iβ"两个数。',
      coreIdea: '"三相 → 两相静止" 的几何投影。三相平衡时只有 2 个自由度，用 αβ 表示更高效，也是 Park 变换前的必经一步。',
      whyCare: [
        'Clarke 是 FOC 链路第一步坐标变换：ADC 三相 → Clarke → Park → PI → 反 Park → SVPWM。',
        'I0（零序分量）= (Ia+Ib+Ic)/3 是测量三相不平衡和 ADC 偏置的"健康指标"。',
        '懂了 Clarke 就懂了"为什么 SVPWM 在 αβ 平面上画六边形"——它们坐标系一样。',
      ],
      firstAction: '右侧切到"手动 Ia/Ib/Ic"，把 Ia 设 5、Ib 设 -5、Ic 设 0。看左侧 αβ 矢量端点跑到 (5, 5.77)。这是教科书例子：α=Ia=5，β=(Ia+2·Ib)/√3=(5−10)/1.732≈-2.89——咦不对？看你试出来对应的数。',
    },
    learningGoals: ['理解 abc 三相坐标到 αβ 静止坐标的投影', '掌握零序分量的意义', '识别三相不平衡时 αβ 矢量的变化'],
    concepts: ['Clarke 变换把三个相电流投影到两个互相垂直的静止轴上。平衡三相只有两个自由度，所以二维就够。', '零序 I0 是三相共同偏移，三相三线电机里通常不能形成有效转矩，但能暴露采样偏置或不平衡。'],
    formulas: [
      { title: 'Clarke 变换（幅值不变）', expression: 'Iα = Ia,   Iβ = (Ia + 2·Ib) / √3', explanation: '工程默认形式：Iα 直接等于 Ia，三相 → 二相只动用一次 sin 系数 1/√3。' },
      { title: '零序分量', expression: 'I0 = (Ia + Ib + Ic) / 3', explanation: '平衡时 ≈ 0；明显偏离 → 排查 ADC 零点、缺相、相阻不一致。' },
      { title: '矩阵形式', expression: '[Iα; Iβ; I0] = (1/3)·[2,−1,−1; 0,√3,−√3; 1,1,1]·[Ia; Ib; Ic]', explanation: '功率不变形式还要除 √(2/3)；嵌入式更常用幅值不变形式。' },
    ],
    engineeringMeaning: ['Clarke 是 FOC 的入口。ADC 三相电流先过 Clarke，后面才有 Park 和电流环。', '两电阻采样常用 Ic = -Ia - Ib 重构第三相，省一路 ADC，但前提是 ADC 偏置校准过且三相和为零的假设成立。'],
    stm32Guide: ['ADC 校准记录三相零电流偏置，运行时先减偏置再 Clarke。', '用 static inline 实现 Clarke 函数，编译器把它直接展开到 FOC 中断，无额外开销。', '常量 1/√3 ≈ 0.5773502692f 预先算好作为 const，避免运行时 sqrt。'],
    commonMistakes: ['没减 ADC 偏置直接用原始电流。', '公式幅值不变 / 功率不变形式混用导致后续 PI 和 SVPWM 标定全错。', '两相采样重构 Ic 时符号写反（应该 Ic = -Ia - Ib，不是 +Ia + Ib）。'],
    debugMethods: ['空载静止时 Iα、Iβ、I0 都应接近 0；偏移就是 ADC 偏置没校准。', '开环 V/f 正弦运行时，αβ 端点应画规则圆；变椭圆 → 三相不平衡或采样标定不一致。', '把 Ia 设 +5 / Ib -2.5 / Ic -2.5（教科书例），应得 Iα=+5, Iβ=0, I0=0。'],
    experiments: ['切换"手动 Ia/Ib/Ic"，故意让三相和不为 0，看 I0 偏离。', '平衡 5A / 0° 相位 → αβ 矢量在 α 轴正方向；相位 90° → β 轴正方向。'],
    summary: 'Clarke 变换 = 把"三个空间方向的标量"投影到"二维平面的矢量"。这是 FOC 用 PI 控两个直流量的几何前提。',
    nextSteps: ['进入 Park 变换，让 αβ 平面"跟着转子一起转"，把交流量变成 dq 直流量。'],
    codeExample: `/* ============================================
 * clarke.h — Clarke 变换（幅值不变形式）
 * 编译器内联展开到 FOC 中断
 * ============================================ */
#define ONE_OVER_SQRT3   0.57735026919f

typedef struct {
    float alpha;
    float beta;
    float zero;     // I0 = (Ia+Ib+Ic)/3，零序，用作健康检查
} alpha_beta_t;

static inline alpha_beta_t clarke(float ia, float ib, float ic) {
    alpha_beta_t o;
    o.alpha = ia;
    o.beta  = (ia + 2.0f * ib) * ONE_OVER_SQRT3;
    o.zero  = (ia + ib + ic) * 0.33333333f;
    return o;
}

/* 两路 ADC 节省版：只用 Ia、Ib，重构 Ic = -Ia-Ib
 * 前提：三相星型且采样准、三相平衡 */
static inline alpha_beta_t clarke_2adc(float ia, float ib) {
    alpha_beta_t o;
    o.alpha = ia;
    o.beta  = (ia + 2.0f * ib) * ONE_OVER_SQRT3;
    o.zero  = 0.0f;     // 假设三相和=0
    return o;
}

/* 健康检查：在调试期定期跑，发现 ADC 偏置漂移 */
static inline int current_health_check(alpha_beta_t s) {
    return fabsf(s.zero) < 0.1f ? 1 : 0;
}`,
    quiz: [
      {
        q: 'Clarke 变换中 Iβ 的标准（幅值不变）公式是？',
        options: ['Iβ = Ib', 'Iβ = (Ia + 2·Ib) / √3', 'Iβ = Ic - Ib', 'Iβ = (Ib - Ic) / √3'],
        correct: 1,
        hint: '幅值不变形式 Iα=Ia, Iβ=(Ia+2Ib)/√3。也有写成 (Ib-Ic)/√3 的等价形式（用 Ic=-Ia-Ib 替换可证）。',
      },
      {
        q: '运行时观测到 I0 = 0.8A，电机额定 6A。最可能的原因？',
        options: ['正常现象', 'ADC 三相零点未校准 / 缺相 / 相阻不平衡', 'PWM 频率太高', 'Park 角度错'],
        correct: 1,
        hint: '平衡三相 I0 应远小于幅值（< 1%）。0.8A/6A=13% 是显著偏移，先校 ADC 偏置。',
      },
      {
        q: '两路 ADC 节省方案 Ic=-Ia-Ib 的隐含前提是？',
        options: ['母线电压稳定', '三相星型连接且 ADC 偏置已减', 'PWM 频率高', '电机静止'],
        correct: 1,
        hint: '前提是 ia+ib+ic=0 严格成立——星型 + ADC 准确。三角形连接相电流和不为 0，方案不成立。',
      },
      {
        q: '如果 Clarke 公式里 Iβ 的 √3 系数写成 √2，会发生什么？',
        options: ['没影响', 'αβ 矢量幅值标定错，Park 算 Id/Iq 全部按比例偏', '电机不转', 'ADC 报错'],
        correct: 1,
        hint: '√3 ≈ 1.732、√2 ≈ 1.414，差 18%。所有依赖 αβ 的下游（PI、限幅、SVPWM）会按这个比例偏掉。',
      },
      {
        q: '功率不变 vs 幅值不变 Clarke，在 FOC 中混用最直接的后果是？',
        options: ['没差别', 'PI 增益、电流限幅、SVPWM 调制比都按 √(2/3) 比例错', '电机抖动', 'ADC 溢出'],
        correct: 1,
        hint: '功率不变多个 √(2/3) ≈ 0.8165 缩放因子。一旦混用，所有下游标定都按这个倍数偏离。',
      },
    ],
  },
  'park-transform': {
    id: 'park-transform',
    introBeginner: {
      metaphor: 'Park 变换就是**站在旋转的木马上看周围**——你和木马一起转，木马上其他点对你看起来就**不动了**。Iαβ 在静止地面看是一个旋转的箭头，但你跳到转子上跟它一起转，那个箭头突然变成"指向固定方向、长度固定"的两根棍子（Id, Iq）。从此 PI 控制器只需控直流量，AC 难题瞬间消失。',
      coreIdea: '同一个电流矢量，αβ 静止坐标系下是个高速正弦变化的 AC 量；dq 同步旋转坐标系下变成稳定的 DC 量。Park 是这两个视角的旋转变换。',
      whyCare: [
        '没有 Park，PI 必须追正弦——稳态相位/幅值误差大。Park 之后 PI 追直流值，零稳态误差。',
        'Id 控磁链、Iq 控转矩——这条解耦让"电流"和"转矩"建立 1:1 关系，是 FOC 精确转矩控制的根基。',
        '编码器零位对齐 = 控制器认知的 d 轴和电机真实磁链方向对齐。零位错 X°，Iq 命令就有 sin(X°) 比例的部分跑到 Id 上，转矩损失 + 电流增大。',
      ],
      firstAction: '右侧把"电角度 θ"从 0 缓慢拖到 360°，看左侧 d/q 轴跟着转。同时观察 Id/Iq 的两条线段长度此消彼长——同一个 αβ 矢量，θ 不同投影出来 Id/Iq 完全不同。',
    },
    learningGoals: ['理解 αβ 静止坐标和 dq 旋转坐标的关系', '掌握 d 轴 / q 轴的物理意义', '看懂"为什么 AC 量在同步坐标中变成 DC 量"'],
    concepts: ['d 轴对准转子永磁体 N 极，q 轴领先 90°（电气角度），主要负责产生转矩。坐标系跟转子同步转。', 'Id 控制磁链，Iq 控制转矩。表贴式 PMSM 默认 Id=0；弱磁时注入负 Id。', 'θ 必须是电角度（机械×极对数），且零位与转子磁链方向严格对齐。'],
    formulas: [
      { title: 'Park 变换', expression: 'Id =  Iα·cos θ + Iβ·sin θ\\nIq = −Iα·sin θ + Iβ·cos θ', explanation: 'θ 是电角度。本质是 αβ 平面绕原点旋转 −θ。' },
      { title: '反 Park（FOC 输出端用）', expression: 'Uα = Vd·cos θ − Vq·sin θ\\nUβ = Vd·sin θ + Vq·cos θ', explanation: '电流 PI 在 dq 域算出 Vd/Vq 后，旋转 +θ 回到 αβ 给 SVPWM。' },
      { title: 'PMSM 转矩', expression: 'Te = 1.5·p·(ψf·Iq + (Ld−Lq)·Id·Iq)', explanation: '表贴式 Ld=Lq → Te ≈ 1.5·p·ψf·Iq，Iq 直接决定转矩。' },
    ],
    engineeringMeaning: ['Park 让 PI 控直流量 → 零稳态误差、可严格整定。', '角度错就 dq 串扰：表现为同样 Iq 命令转矩偏小、电流偏大、效率下降。', '低分辨率编码器 + 高极对数 → 角度抖动直接转化成 dq 抖动 → 电流环噪声。'],
    stm32Guide: ['θ_e 来自编码器（机械×极对数）或观测器（无感）；进 sin/cos 前归一化到 [0, 2π)。', 'sincosf 单次调用同时算 sin/cos，比分别 sinf+cosf 快 ~30%。', '查表 + 线性插值（256 表 + 8bit 插值）能把 sin/cos 压到 < 50ns，适合 < 100MHz MCU。'],
    commonMistakes: ['角度方向（顺/逆时针）和电机相序不匹配，电机反转或转不动。', '机械角度直接当电角度（漏乘极对数）。', '编码器零位没对齐 → 启动一上电 Iq=0 也有转矩偏移。', 'sin/cos 符号写错（反 Park 与 Park 必须用同一个 θ 同一种符号）。'],
    debugMethods: ['零速锁定（Vq=0、Vd=固定值）让转子停在 d 轴零位，再清编码器零点。', '低速开环（开环 V/f）记录 Id/Iq；理想情况 Id ≈ 0、Iq 对应负载电流；偏离 → 角度方向或零位错。', '阶跃测试：给 Iq=2A、Id=0；正常 Iq 跟踪、Id 接近 0。Id 飘 ±0.5A 以上 = 角度误差。'],
    experiments: ['拖电角度 θ，观察同一 αβ 在 dq 上投影变化。', '设 Iα=5、Iβ=0、θ=0 → Id=5, Iq=0；θ=90° → Id=0, Iq=5。', '故意改 θ 偏离 15°，观察 Id 漂移到 sin(15°)·5 ≈ 1.3A。'],
    summary: 'Park 变换 = "与转子同步看世界"。它把交流控制变成直流控制，给 PI 创造工作前提。',
    nextSteps: ['进入 PID 模块，学习如何用 PI 闭环跟踪 Id/Iq 阶跃指令。'],
    codeExample: `/* ============================================
 * park.h — Park / 反 Park 变换
 * STM32 FPU 直接算 sincosf；老芯片可换查表
 * ============================================ */

typedef struct { float d; float q; } dq_t;
typedef struct { float alpha; float beta; } alpha_beta_t;

/* αβ → dq （Park） */
static inline dq_t park(float alpha, float beta, float theta_e) {
    float s, c;
    sincosf(theta_e, &s, &c);    // 单次同时算
    dq_t o;
    o.d =  alpha * c + beta * s;
    o.q = -alpha * s + beta * c;
    return o;
}

/* dq → αβ （反 Park）*/
static inline alpha_beta_t inv_park(float vd, float vq, float theta_e) {
    float s, c;
    sincosf(theta_e, &s, &c);
    alpha_beta_t o;
    o.alpha = vd * c - vq * s;
    o.beta  = vd * s + vq * c;
    return o;
}

/* === 编码器零位对齐（启动时一次性执行）===
 * 给定 Vd > 0、Vq = 0，转子被强制对齐到 d 轴零位。
 * 然后清编码器计数器，记录这一刻为 encoder_zero。
 */
void align_encoder_zero(uint32_t *out_zero) {
    /* 给 d 轴施加 1A 等效电流（开环电压模式） */
    set_open_loop_voltage(2.0f /*Vd*/, 0.0f /*Vq*/, 0.0f /*theta_e*/);
    HAL_Delay(800);                 // 等转子稳定
    *out_zero = ENCODER->CNT;       // 此刻 d 轴零位
    set_open_loop_voltage(0, 0, 0); // 释放
}

/* 用法：
 *   align_encoder_zero(&calib.enc_zero);   // 上电一次
 *   // 之后每 PWM 中断：
 *   theta_e = encoder_to_theta_e(ENCODER->CNT, calib.enc_zero, p);
 *   dq_t i = park(i_alpha, i_beta, theta_e);
 */`,
    quiz: [
      {
        q: '同一个 Iα=5, Iβ=0，电角度 θ 从 0° 变到 90°，Id/Iq 怎么变？',
        options: ['始终 Id=5, Iq=0', 'Id 从 5 变到 0、Iq 从 0 变到 5', 'Id/Iq 同时 5', '不变'],
        correct: 1,
        hint: 'Id = α cos θ + β sin θ，Iq = −α sin θ + β cos θ。θ=0 → (5,0)，θ=90° → (0,5)。',
      },
      {
        q: '编码器零位偏 10° 没校准，给 Iq=5、Id=0 命令，Id 实际值大约多少？',
        options: ['0', '5', '5·sin(10°) ≈ 0.87', '5·cos(10°) ≈ 4.92'],
        correct: 2,
        hint: 'Park 角度误差 Δθ 让 Iq 命令"溢"到 Id 上一份 sin(Δθ) 比例。Iq 自己只剩 cos(Δθ)·5。',
      },
      {
        q: '表贴式 PMSM (Ld=Lq)，转矩主要由谁决定？',
        options: ['Id', 'Iq', '|αβ| 总幅值', '电频率 ω'],
        correct: 1,
        hint: 'Te = 1.5p(ψf·Iq + (Ld−Lq)·IdIq)。Ld=Lq 时第二项为 0，Iq 是唯一决定者。',
      },
      {
        q: '弱磁控制中注入负 Id 的物理意义是？',
        options: ['增加转矩', '减小等效磁链 → 降低反电动势 → 换取更高转速', '降低损耗', '保护硬件'],
        correct: 1,
        hint: '负 Id 沿 −d 方向去减弱永磁磁链 ψf，让 BEMF = Ke·ω 减小，给逆变器输出腾出电压余量。',
      },
      {
        q: 'Park 和反 Park 在 FOC 链路上的作用顺序？',
        options: ['两个都在最前', 'Park 先（采样侧），反 Park 后（输出侧）', '反 Park 先', '同时使用'],
        correct: 1,
        hint: 'ADC → Clarke → Park → PI → 反 Park → SVPWM → 桥臂。Park 把"测量 αβ"变 dq；反 Park 把"PI 输出 Vdq"变回 αβ。',
      },
    ],
  },
  'pid-control': {
    id: 'pid-control',
    introBeginner: {
      metaphor: 'PID 就像调淋浴水温：**P** 像直接拧——水太冷就猛拧热水（拧多大与冷热差成正比）；**I** 是慢慢补——还差一点就持续多加一点直到水温就位；**D** 是预判——感觉水温正在快速变化时先反向收一下避免过头。这三项加在一起，让"输出"自动跟踪"目标值"。',
      coreIdea: 'PID = 当前误差(P) + 历史累积(I) + 变化趋势(D)。电机控制 99% 的场景只用 PI（P+I），D 在位置环或抖动很大时才加。',
      whyCare: [
        '电流环、速度环、位置环全是 PID/PI——会调一个就会调全套。',
        'Kp 太低响应慢，太高振荡过流；Ki 不够稳态有余差，太大积分饱和大超调。',
        '"采样周期改变后必须重算 Ki/Kd"是无数初学者翻车的坑——PID 参数和 Ts 是绑定的。',
      ],
      firstAction: '右侧拖 Kp 从 2.2 慢慢推到 8，看响应曲线从光滑爬升变成超调振荡。再点"振荡预设"看极端情况，然后开"抗积分饱和"对比关闭时大超调的差异。',
    },
    learningGoals: ['理解 P、I、D 三项的物理作用', '区分电流环 PI、速度环 PI、位置环 PID 各自的角色', '识别超调 / 稳态误差 / 振荡 / 积分饱和四类典型病症'],
    concepts: ['P 像弹簧，误差越大推得越猛；I 像记账本，长期误差被慢慢补掉；D 像阻尼器，抑制变化太快。', '电机控制中电流环用 PI（带宽 1-5 kHz），速度环用 PI（带宽 50-500 Hz），位置环常用 PID 或前馈。', '抗积分饱和：输出撞限幅时停止/减小积分累加，避免释放限幅后大超调。'],
    formulas: [
      { title: '离散位置式 PID', expression: 'u[k] = Kp·e[k] + Ki·Ts·Σe + Kd·(e[k]−e[k−1])/Ts', explanation: 'Ts 是采样周期；输出 u 必须限幅，否则积分会越攒越大。' },
      { title: '增量式 PID', expression: 'Δu[k] = Kp·(e[k]−e[k−1]) + Ki·Ts·e[k] + Kd·(e[k]−2·e[k−1]+e[k−2])/Ts', explanation: '每次只算"增量"，无需保存积分；自带防积分饱和（误差为零时输出不变）。' },
      { title: '抗积分饱和（Back-Calculation）', expression: 'I[k+1] = I[k] + Ki·Ts·e[k] + Kt·(u_sat − u_unsat)', explanation: 'Kt 是回写增益，让积分按饱和差值反向调整。Kt = Ki/Kp 是经验起点。' },
    ],
    engineeringMeaning: ['参数过小响应慢，参数过大振荡甚至过流。抗积分饱和必须开。', '内环带宽 ≥ 外环带宽 × 5～10，否则外环追内环会振荡。', '采样周期 Ts 是 PID 参数的"刻度尺"——Ts 减半，要么 Ki/2 + Kd×2 重算，要么改用增量式更稳。'],
    stm32Guide: ['PID 状态结构体含 integral / last_error / out_min / out_max / Kt。', '电流环固定在 PWM 中断（16-20kHz），速度环以 1-5kHz 分频执行。', '所有浮点 PID 函数加 static inline，编译器展开到中断后无函数调用开销。'],
    commonMistakes: ['积分没限幅 → 撞限幅后大超调甚至过流保护。', '电流环和速度环同频同样高带宽 → 互相打架振荡。', '改 Ts 后没重算 Ki/Kd → 行为完全变样。', '没区分位置式/增量式，混着写。'],
    debugMethods: ['整定顺序：先电流环（看 Iq 阶跃响应），再速度环（看转速阶跃），最后位置环。', '只调 P 找到刚开始振荡的 Kp_critical，取 0.4-0.6 倍作为工作点。', '加 I 直到稳态误差 < 1%，再观察是否有积分振荡。', 'D 通常先设 0；位置环抖动严重时再加，且要带低通避免噪声放大。'],
    experiments: ['加载"慢响应"预设 → 看上升时间长。', '加载"振荡"预设 → 看明显超调和持续振荡。', '关掉"抗积分饱和"+ 设 Ki 较大 + 大目标值 → 看撞限释放后的"积分饱和大超调"。'],
    summary: 'PID 不是玄学旋钮，是带采样周期 / 限幅 / 抗饱和的一套工程闭环。会调一个就会调全部。',
    nextSteps: ['把 PI 放进 FOC 电流环，观察 Id/Iq 跟踪与限幅互动。'],
    codeExample: `/* ============================================
 * pi.h — 带抗积分饱和的 PI 控制器（增量式 + Back-Calculation）
 * 适合电机电流环、速度环
 * ============================================ */

typedef struct {
    float kp;
    float ki;             // 真实增益，注意 Ts 已含在使用方式里
    float ts;             // 采样周期 (s)
    float integral;
    float out_min;
    float out_max;
    float kt;             // 抗饱和回写增益，建议 = ki / kp
} pi_t;

static inline void pi_init(pi_t *c, float kp, float ki, float ts,
                           float lim_min, float lim_max) {
    c->kp = kp;  c->ki = ki;  c->ts = ts;
    c->integral = 0.0f;
    c->out_min = lim_min;  c->out_max = lim_max;
    c->kt = (kp > 1e-6f) ? (ki / kp) : 0.0f;
}

/* 单步 PI（位置式 + 抗积分饱和回写） */
static inline float pi_step(pi_t *c, float ref, float meas) {
    float err = ref - meas;

    /* 1. 先算未饱和输出 */
    float u_unsat = c->kp * err + c->integral;

    /* 2. 限幅 */
    float u = u_unsat;
    if (u > c->out_max) u = c->out_max;
    else if (u < c->out_min) u = c->out_min;

    /* 3. 积分更新 + 抗饱和回写
     *    撞限时 (u_unsat - u) 反符号写回积分，让它退一点 */
    c->integral += c->ki * c->ts * err + c->kt * (u - u_unsat);

    return u;
}

void pi_reset(pi_t *c) { c->integral = 0.0f; }

/* === 整定建议 ===
 * 电流环：Kp = ω_bw × L,  Ki = ω_bw × R
 *   想要 1 kHz 带宽（ω_bw = 6283 rad/s）+ L = 1.2 mH + R = 0.55 Ω：
 *     Kp ≈ 7.5,  Ki ≈ 3450
 *   PWM = 16 kHz → Ts = 62.5 μs，实际整定先取 Kp = 1-2 安全起步
 * 速度环：内环带宽 / 5-10 倍，Kp 试 0.05-0.3，Ki 试 0.5-3
 */`,
    quiz: [
      {
        q: 'PID 的 I（积分）项主要解决什么问题？',
        options: ['加快响应', '消除稳态误差', '抑制噪声', '降低过流风险'],
        correct: 1,
        hint: 'P 项只在有误差时输出；当误差小但非零，需要 I 慢慢累加把它推到位。这就是"消除稳态余差"。',
      },
      {
        q: '关掉抗积分饱和、Ki 较大时给一个超出限幅的大目标值，撞限后会怎样？',
        options: ['没影响', '正常', '积分一直累加，限幅释放后产生大超调和长时间振荡', 'PWM 关断'],
        correct: 2,
        hint: '撞限期间积分仍在累加，攒了一大笔"虚假积分"。一旦目标改回正常，积分要花很长时间反方向消化，期间输出大超调。',
      },
      {
        q: '电流环带宽 1 kHz、速度环带宽多少最合理？',
        options: ['同样 1 kHz', '500 Hz', '100-200 Hz', '5 kHz'],
        correct: 2,
        hint: '外环带宽要远小于内环（5-10×），否则外环命令变化太快内环跟不上 → 互相打架振荡。',
      },
      {
        q: '采样周期 Ts 从 1ms 改成 0.5ms（采样率翻倍），位置式 PID 的 Ki 该怎么调？',
        options: ['不变', 'Ki 加倍', 'Ki 减半', '改 Kp'],
        correct: 2,
        hint: '位置式 I 项 = Ki·Ts·Σe，Ts 减半要保持等效积分增益就要 Ki 加倍——但更可靠的做法是不动 Ki，改用增量式 PID。',
      },
      {
        q: 'D（微分）项在电机控制里通常不加，主要原因是？',
        options: ['硬件不支持', '数学复杂', '采样噪声经过 (e[k]-e[k-1])/Ts 微分会被放大，反而引入抖动', '没必要'],
        correct: 2,
        hint: 'D 项放大高频噪声。位置环必要时加 D 也要先低通滤波。电流环和速度环用 PI 已足够。',
      },
    ],
  },
  'foc-flow': {
    id: 'foc-flow',
    introBeginner: {
      metaphor: 'FOC 就像给三相交流电机装了一台"翻译机"。普通办法直接调三相电压，电机看到的是不停旋转的复杂波形，没法精确控转矩。FOC 把复杂的三相变成两个稳定的直流量（Id 控磁链、Iq 控转矩），就像把摇晃的船舱地板换成静止的——你站在静止的地板上调阀门容易得多。',
      coreIdea: 'FOC 不是某个单一公式，而是一条**每个 PWM 周期跑一遍**的流水线：采样 → Clarke → Park → 电流 PI → 反 Park → SVPWM → 输出。每个环节只做一件事，错了能定位。',
      whyCare: [
        '不会 FOC，PMSM 调起来就是开环加点小聪明，转矩控不准、效率低、动态差。',
        'FOC 是新能源汽车驱动、伺服、机器人关节的工业标准。学会它你就能读懂 90% 的电机控制代码。',
        '搞清楚流水线每一段后，遇到"电机抖动""启动失败"等问题能精准定位（采样？角度？PI？SVPWM？硬件？）',
      ],
      firstAction: '点击顶部"电流环响应"标签，把右边 Iq 阶跃指令拖到 5A，看 Iq（绿）追指令（虚线）的过程。然后把"角度误差 Δθ"从 0 拖到 15°，看 Iq 阶跃时 Id（蓝）也被拉起来——这就是著名的"dq 串扰"。',
    },
    learningGoals: ['串起采样、Clarke、Park、电流环、反 Park、SVPWM 和反馈角度', '理解 FOC 流水线每段的输入输出', '能定位电流环超调 / 振荡 / 串扰的根因'],
    concepts: ['FOC 每个 PWM 周期做一次"小闭环"：采电流 → 算坐标 → 跑 PI → 算电压矢量 → 更新 PWM → 等待下一次反馈。', '角度反馈可来自编码器或观测器；角度质量直接决定 dq 解耦质量。', 'PI 在 dq 域工作（直流量），比直接控三相 AC 简单得多。', '电流环带宽 ω_bw ≈ Kp / L，Ki / Kp = R / L 是临界阻尼起点。'],
    formulas: [
      { title: 'FOC 流水线', expression: 'abc → Clarke → Park → PI(Id, Iq) → inv-Park → SVPWM → 桥臂', explanation: '每一段都是纯函数，输入输出明确，便于移植到 C / STM32 / MATLAB。' },
      { title: 'dq PMSM 模型', expression: 'vd = R·id + Ld·did/dt - ω·Lq·iq;  vq = R·iq + Lq·diq/dt + ω·(Ld·id + ψf)', explanation: 'dq 之间存在交叉耦合项 ω·L·iq 和 ω·L·id；速度越高耦合越强，需要在 PI 输出加解耦前馈。' },
      { title: '电流环典型整定', expression: 'Kp = ω_bw × L,  Ki = ω_bw × R', explanation: '想要 1 kHz 带宽，Kp = 6283 × 0.0012 ≈ 7.5（实际 PWM 16k 时取 1-3 较稳）。Ki/Kp = R/L 让零点抵消极点。' },
    ],
    engineeringMeaning: [
      '流水线拆开后，"电机抖动"可以精确定位：采样错？角度错？PI 振荡？SVPWM 饱和？硬件直通？',
      '电流环带宽决定速度环最大可用带宽。一般电流环 1-5 kHz，速度环 50-500 Hz，差 10× 才稳。',
      '角度误差 Δθ 直接体现在 Iq 阶跃时 Id 跳一下：这是判断编码器零位是否对齐的实战手段。',
    ],
    stm32Guide: [
      'PWM 中心对齐 16-20kHz，ADC 采样点放在 PWM 中点（电流纹波最小处），中断里完整跑完 FOC 链。',
      'TIM1/TIM8 + ADC1/ADC2 用 InjectedConv + DMA 双采，CPU 只在中断尾部处理（< 5μs）。',
      '所有算法（Clarke/Park/PI/SVPWM）写成纯函数，主循环传引用，方便单元测试和移植。',
    ],
    commonMistakes: ['在 UI 或业务层写控制算法，无法移植和单元测试。', '中断里加 printf / HAL_Delay / 浮点除法，PWM 周期超时。', '采样点选在 PWM 边沿附近（噪声大）。', 'PI 没做抗积分饱和，输出撞限幅后释放出大超调。', '没在中断尾部用 __DSB() 确保 CCR 写入生效。'],
    debugMethods: ['按段冻结调试：先 ADC 校零（ia+ib+ic ≈ 0）→ 再开环转电压矢量看转子能否拖动 → 再上电流环 → 最后上速度环。', '在 RTT/串口每个 PWM 周期记录 ia/ib/ic/iα/iβ/id/iq/vd/vq/duty 和 sector，跟波形发生器/示波器对照。', '电流环超调先怀疑 Kp 太大或采样延迟过多；稳态误差先看 Ki 和限幅。'],
    experiments: [
      '把"角度误差 Δθ"从 0 拖到 ±15°，看 Iq 阶跃时 Id 出现峰值——这是 dq 串扰的物理表现。',
      '把"电频率 ω"从 0 拉到 200Hz，看 Iq 上升过程中带"晃动"——这是交叉耦合 ω·L·iq 进入 vd 的结果。',
      '把"采样延迟"从 1 拉到 4，相同 Kp 下振荡明显加重——延迟等效相位裕度损失。',
      '加载"过激振荡"预设，再把 Kp 减半，对比超调减小。',
    ],
    summary: 'FOC 不是数学难，是工程链路长。把每段都看成一个可独立验证的纯函数，整个系统才稳。',
    nextSteps: ['深入 SVPWM 模块，看反 Park 的 Uα/Uβ 怎么变成 6 个开关状态加零矢量。'],
    codeExample: `/* ============================================
 * foc.c — FOC 中断主循环（运行在 PWM 16kHz ISR 内）
 * 适配 STM32G4 (Cortex-M4F + FPU)，单次执行 < 6 μs
 * ============================================ */
#include "foc.h"

static pi_state_t g_pi_d = { .integral = 0 };
static pi_state_t g_pi_q = { .integral = 0 };

void TIM1_UP_TIM16_IRQHandler(void) {
    if (TIM1->SR & TIM_SR_UIF) {
        TIM1->SR = ~TIM_SR_UIF;

        /* 1. 采样三相电流（ADC 注入序列已经触发） */
        float ia = adc_to_amps(ADC1->JDR1, g_offset.ia);
        float ib = adc_to_amps(ADC1->JDR2, g_offset.ib);
        float ic = -ia - ib;     // 三相和为零，省一路 ADC

        /* 2. 读电角度（编码器/观测器） */
        float theta_e = encoder_to_theta_e(
            ENCODER->CNT, g_param.encoder_zero, g_param.pole_pairs);
        float sin_t, cos_t;
        sincosf(theta_e, &sin_t, &cos_t);

        /* 3. Clarke：abc → αβ */
        float i_alpha = ia;
        float i_beta  = ONE_OVER_SQRT3 * (ia + 2.0f * ib);

        /* 4. Park：αβ → dq（同步旋转坐标） */
        float i_d =  cos_t * i_alpha + sin_t * i_beta;
        float i_q = -sin_t * i_alpha + cos_t * i_beta;

        /* 5. 电流 PI（在 dq 域，控直流量） */
        float v_d = pi_step(&g_pi_d, g_ref.id - i_d, g_param.kp, g_param.ki, DT);
        float v_q = pi_step(&g_pi_q, g_ref.iq - i_q, g_param.kp, g_param.ki, DT);

        /* 5b. 解耦前馈（高速时建议加，低速可省） */
        v_d -= 2.0f * M_PI * g_state.elec_freq * g_param.lq * i_q;
        v_q += 2.0f * M_PI * g_state.elec_freq * (g_param.ld * i_d + g_param.psi_f);

        /* 5c. 圆形限幅（SVPWM 线性区 ≈ Udc/√3） */
        float v_lim = g_state.udc * ONE_OVER_SQRT3 * 0.95f;
        float v_mag = sqrtf(v_d*v_d + v_q*v_q);
        if (v_mag > v_lim) { v_d *= v_lim/v_mag; v_q *= v_lim/v_mag; }

        /* 6. 反 Park：dq → αβ */
        float v_alpha = cos_t * v_d - sin_t * v_q;
        float v_beta  = sin_t * v_d + cos_t * v_q;

        /* 7. SVPWM：αβ → 三相占空比 */
        svpwm_t sv = svpwm_calc(v_alpha, v_beta, g_state.udc);

        /* 8. 写入 CCR（下一个 PWM 周期生效） */
        TIM1->CCR1 = (uint16_t)(sv.duty_a * TIM1->ARR);
        TIM1->CCR2 = (uint16_t)(sv.duty_b * TIM1->ARR);
        TIM1->CCR3 = (uint16_t)(sv.duty_c * TIM1->ARR);
        __DSB();
    }
}`,
    quiz: [
      {
        q: 'FOC 在 dq 坐标里做 PI，相比直接在 abc 做控制最大的好处是什么？',
        options: ['计算量少', '稳态时控制对象是直流量，PI 可以严格消除稳态误差', '不需要传感器', '硬件成本低'],
        correct: 1,
        hint: 'abc 三相是 AC 量，标准 PI 跟踪 AC 会有稳态相位/幅值误差；dq 是 DC 量，PI 可以做到零稳态误差。',
      },
      {
        q: '电流环 Kp 增大到使 Iq 出现 30% 超调和振荡，最可能的原因？',
        options: ['Ki 太小', '电压限幅太大', 'Kp 已经超过电流环带宽 / 采样延迟匹配', '电机参数错'],
        correct: 2,
        hint: '电流环带宽 ω_bw ≈ Kp/L。Kp 太大让 ω_bw 高于 1/(2π·延迟)，相位裕度耗尽就开始振荡。',
      },
      {
        q: '同时给 Iq 阶跃指令但 Id 也被拉起来一个峰值，最可能的原因？',
        options: ['Kp 不够', '编码器零位没对齐 / 角度有误差 Δθ', 'PWM 频率太低', 'ADC 采样错'],
        correct: 1,
        hint: 'Iq 投影到错误旋转的 d 轴上就会"溢"到 Id 上。试改"角度误差 Δθ"看现象。',
      },
      {
        q: '高速运行时电流环响应变慢、有晃动，加什么能改善？',
        options: ['加大 Kp', '加大 Ki', '加 dq 解耦前馈（vd 减 ω·Lq·iq、vq 加 ω·(Ld·id + ψf)）', '降低 PWM 频率'],
        correct: 2,
        hint: '高速时 ω·L 项让 d/q 互相干扰，靠 PI 反馈修复慢。前馈直接抵消这部分耦合。',
      },
      {
        q: 'FOC 中断里出现下面哪个最危险？',
        options: ['浮点乘加', 'sincosf 调用', 'printf 或 HAL_Delay', 'CCR 写入'],
        correct: 2,
        hint: 'printf/Delay 阻塞数百 μs 到 ms 级，PWM 周期 60μs 完全装不下，会立刻丢拍。',
      },
    ],
  },
  'svpwm': {
    id: 'svpwm',
    introBeginner: {
      metaphor: 'SVPWM 像调色——你想要"任意方向的电压矢量"，但调色板上只有 8 种基本色（V0-V7 = 8 种开关状态）。SVPWM 在每个 PWM 周期里**按时间比例混合**最近的两种基本色 + 一种"白色"（零矢量），让平均下来等于你想要的颜色。',
      coreIdea: '把 αβ 平面六边形划成 6 个扇区，每个扇区用相邻两个有效矢量 V_k、V_{k+1} 加零矢量 V0/V7 按时间 T1、T2、T0 加权合成目标 Uαβ。',
      whyCare: [
        'SVPWM 比 SPWM 多 15% 母线利用率，电机能转更高速度；电动车、伺服基本都用 SVPWM。',
        '六个扇区 + 8 种开关状态是逆变器与电机之间的"语法"——读懂代码、读懂硬件波形都靠它。',
        '过调制（m > 1.0）和扇区误判是常见 bug，看六边形图是最直观的诊断方式。',
      ],
      firstAction: '把右侧"电角度"从 0° 缓慢拖到 360°，看左侧六边形里的扇区高亮按 1→2→3→4→5→6 顺序切换。再把"调制比"拉到 0.95 看 T0 接近 0；拉过 1.0 进入饱和（红色徽标）。',
    },
    learningGoals: ['理解六个有效矢量、两个零矢量和六个扇区的关系', '掌握 T1/T2/T0 与占空比 dutyA/B/C 计算', '区分 SVPWM 与 SPWM 母线利用率的差距和原因'],
    concepts: ['SVPWM 不是给三相正弦，而是 PWM 周期内组合相邻两个有效矢量和零矢量让"平均电压"等于目标矢量。', '目标落在哪个 60° 扇区，就用该扇区两侧基本矢量；扇区由 atan2(Uβ, Uα) 决定。', 'V0(000)/V7(111) 是零矢量，让"中点电压"为 0；插入它们以补足周期。'],
    formulas: [
      { title: '扇区判断', expression: 'sector = floor(atan2(Uβ, Uα) / 60°) + 1', explanation: '把 [0, 2π) 角度均分 6 段，每段 60°。归一化时注意正负。' },
      { title: 'T1, T2 计算（扇区 N，0 ≤ θ-N·60° ≤ 60°）', expression: 'T1 = m·sin((N·60° - θ + 60°))·Ts\\nT2 = m·sin(θ - (N-1)·60°)·Ts\\nT0 = Ts - T1 - T2', explanation: 'm 是调制比，Ts 是 PWM 周期。T0 < 0 → 进入过调制需要钳位。' },
      { title: '调制比', expression: 'm = √3·|Uref| / Udc', explanation: 'm = 1 是 SVPWM 线性区上限（比 SPWM 的 m=1 高 √3/2 ≈ 1.155 倍利用率）。' },
      { title: '三相占空比', expression: 'Tcm = (Ts + T1 - T2)/2 等（按扇区分）\\nduty = Tc / Ts', explanation: '中心对齐 PWM 中常用"七段式"序列：000 → 100 → 110 → 111 → 110 → 100 → 000，对应三相 duty。' },
    ],
    engineeringMeaning: ['SVPWM 比 SPWM 利用率高 √3/2 ≈ 15.5%——同样母线电压能转更快，省母线电容。', 'SVPWM 等价于 SPWM + 三次谐波注入；嵌入式实现常用"min-max"算法（duty = sinusoidal - (max+min)/2）只需一次 sin/cos 累加。', '过调制处理：m > 1 时按比例缩短 T1/T2 让 T0 ≥ 0，或者切到六步运行。'],
    stm32Guide: ['计算出 dutyA/B/C ∈ [0, 1] 后写 TIMx->CCR = (uint16_t)(duty × ARR)。', '中心对齐 PWM + ADC 注入序列，采样点放在 PWM 中点（电流纹波最小）。', 'min-max 实现一行：duty_a = (Vα·k1 + offset)；offset = -(max(va,vb,vc)+min(va,vb,vc))/2。'],
    commonMistakes: ['扇区边界 0°/360° 归一化错（atan2 返回 [−π, π]，需要 +2π 后再除 60）。', 'T0 < 0 没钳位继续输出，duty 异常。', '三相 duty 没限到 [0.02, 0.98]，PWM 比较器吃不到。', '七段式和五段式序列搞混。'],
    debugMethods: ['旋转 Uα/Uβ 一周，检查扇区按 1→2→3→4→5→6→1 顺序切换。', '低调制比（m < 0.5）时三相 duty 应是平滑正弦+1.5 次谐波样的"鞍形波"。', '示波器抓 PWM_A 和 PWM_B 上桥臂，相差应有相位关系而不是同步。'],
    experiments: ['加载"SVPWM 扇区切换"预设，缓慢调电角度看 6 个扇区依次高亮。', '加载"过调制"预设（m > 1），看红色饱和警告。', '比较母线利用率指标：SVPWM 71.1% vs SPWM 82.1% 在不同 m 下的差。'],
    summary: 'SVPWM = "把目标电压矢量按时间分给 6 个扇区两侧的有效矢量 + 零矢量"。代码里就是判扇区 → 算 T1/T2/T0 → 算 duty 三步。',
    nextSteps: ['进入逆变器模块，看 duty 如何变成相电压和线电压（含死区损失）。'],
    codeExample: `/* ============================================
 * svpwm.h — SVPWM 算法（min-max 实现，单次 PWM 中断 < 1μs）
 * 适配 STM32 高级定时器，输出范围 [0, 1] 直接喂 CCR
 * ============================================ */

#define ONE_OVER_SQRT3   0.57735026919f

typedef struct {
    float duty_a;       // 三相上桥臂占空比 [0, 1]
    float duty_b;
    float duty_c;
    uint8_t sector;     // 1-6
    uint8_t saturated;  // 1 = 进入过调制
} svpwm_t;

/* 输入 αβ 电压指令（V），母线电压 Udc（V），返回三相 duty */
svpwm_t svpwm_calc(float v_alpha, float v_beta, float udc) {
    svpwm_t r = { 0 };

    /* 1. min-max 算法核心：等价于 SPWM + 三次谐波注入
     *    Va_ref = Vα
     *    Vb_ref = -0.5·Vα + (√3/2)·Vβ
     *    Vc_ref = -0.5·Vα - (√3/2)·Vβ
     */
    const float SQRT3_2 = 0.8660254038f;
    float va = v_alpha;
    float vb = -0.5f * v_alpha + SQRT3_2 * v_beta;
    float vc = -0.5f * v_alpha - SQRT3_2 * v_beta;

    /* 2. 找出 max / min，注入 -(max+min)/2 */
    float vmax = va > vb ? (va > vc ? va : vc) : (vb > vc ? vb : vc);
    float vmin = va < vb ? (va < vc ? va : vc) : (vb < vc ? vb : vc);
    float offset = -0.5f * (vmax + vmin);

    /* 3. 归一化到 [0, 1] 占空比 */
    float scale = 1.0f / udc;
    r.duty_a = 0.5f + (va + offset) * scale;
    r.duty_b = 0.5f + (vb + offset) * scale;
    r.duty_c = 0.5f + (vc + offset) * scale;

    /* 4. 限幅 */
    if (r.duty_a < 0.0f) { r.duty_a = 0.0f; r.saturated = 1; }
    if (r.duty_a > 1.0f) { r.duty_a = 1.0f; r.saturated = 1; }
    if (r.duty_b < 0.0f) { r.duty_b = 0.0f; r.saturated = 1; }
    if (r.duty_b > 1.0f) { r.duty_b = 1.0f; r.saturated = 1; }
    if (r.duty_c < 0.0f) { r.duty_c = 0.0f; r.saturated = 1; }
    if (r.duty_c > 1.0f) { r.duty_c = 1.0f; r.saturated = 1; }

    /* 5. 顺手算扇区 (诊断/可视化用) */
    float angle = atan2f(v_beta, v_alpha);
    if (angle < 0) angle += 2.0f * M_PI;
    r.sector = (uint8_t)(angle * (3.0f / M_PI)) + 1;
    if (r.sector > 6) r.sector = 6;

    return r;
}

/* 用法（FOC 中断尾部）：
 *   svpwm_t s = svpwm_calc(v_alpha, v_beta, g_state.udc);
 *   TIM1->CCR1 = (uint16_t)(s.duty_a * (TIM1->ARR + 1));
 *   TIM1->CCR2 = (uint16_t)(s.duty_b * (TIM1->ARR + 1));
 *   TIM1->CCR3 = (uint16_t)(s.duty_c * (TIM1->ARR + 1));
 */`,
    quiz: [
      {
        q: 'SVPWM 比 SPWM 在母线利用率上的优势大约是？',
        options: ['完全没差', '15% 左右', '50%', '一倍'],
        correct: 1,
        hint: 'SPWM 线性区 m_max ≈ 1，对应输出电压 0.5·Udc 峰值。SVPWM m_max ≈ 1，对应 Udc/√3 峰值，多 √3/2 ≈ 1.155 倍 = 15.5%。',
      },
      {
        q: '六边形顶点 V1 对应的上桥臂状态码是？',
        options: ['000', '100', '110', '111'],
        correct: 1,
        hint: 'V1 = (100) = A 高、B 低、C 低。V2(110), V3(010), V4(011), V5(001), V6(101)，V0(000)/V7(111) 是零矢量。',
      },
      {
        q: '调制比 m > 1.0 时进入"过调制"，硬件上会发生什么？',
        options: ['没影响', '某些 PWM 周期 T0 < 0，被钳到 0，输出非线性', 'PWM 关断', 'ADC 错'],
        correct: 1,
        hint: 'T0 < 0 物理上不可能（零矢量没法负时间）。代码会钳到 0，让 T1+T2 = Ts，结果输出失真，增加电流谐波。',
      },
      {
        q: '为什么 SVPWM 等价于 "SPWM + 注入三次谐波"？',
        options: ['偶然', 'min-max 偏置注入正好是相电压的三次谐波，三相和为 0 不影响线电压', '历史原因', '便于编程'],
        correct: 1,
        hint: '三次谐波在三相相同（同相），加进每相 duty 不改变线电压，但能让中性点电压"下沉"，扩大可用相电压范围 → 利用率提升。',
      },
      {
        q: '中心对齐 PWM + 注入 ADC 触发 + 七段式 SVPWM，采样点放在 PWM 中点的好处是？',
        options: ['硬件要求', '中点是开关切换刚结束、电流稳定区，纹波最小', '减少代码量', '无功消耗低'],
        correct: 1,
        hint: '中心对齐计数器达到 ARR 时触发 ADC 注入，此时所有桥臂处于稳定状态（同一组开关组合），电流纹波最小。',
      },
    ],
  },
  'inverter': {
    id: 'inverter',
    introBeginner: {
      metaphor: '逆变器就像 6 个开关组成的"接力开关阵"——上下两个开关互相 toggle，把直流母线斩成想要的交流相电压。要保护这些开关不烧（"死区"=不让上下管同时开），又要把死区造成的失真补偿回来。',
      coreIdea: '6 个 MOSFET/IGBT 三对，每对上下管互补导通；占空比决定平均相电压；死区时间是必要的保护代价但会造成低速电压畸变。',
      whyCare: [
        '不会写 PWM + 死区设置，FOC 算法再好也炸管。',
        '低速小电流时死区损失最明显，是"低速啸叫""波形毛刺"的常见根因。',
        'STM32 高级定时器（TIM1/TIM8）的互补 + 死区 + 刹车输入是工业级电机控制的硬件支撑，必须熟练。',
      ],
      firstAction: '右侧把"死区时间"从 1μs 拉到 4μs，看相电压波形顶部出现明显凹槽（死区损失增大）。再把"PWM 频率"从 16kHz 降到 4kHz，看死区在每个周期占比变大、损失放大。',
    },
    learningGoals: ['认识三相桥、上下桥臂互补和死区机制', '理解占空比 → 相电压 → 线电压的换算', '识别死区失真、过调制和直通风险'],
    concepts: ['三相桥 6 个开关分 3 对（A/B/C 相），每对上下互补；同时导通 = 直通短路炸管。', '死区时间 td：上管关断后等 td 再开下管，避免直通；典型 0.5-3 μs。', '平均相电压 Va = (Da - 0.5)·Udc；线电压 Vab = Va - Vb。', '死区损失 ΔV ≈ td × fpwm × Udc，与电流方向有关。'],
    formulas: [
      { title: '平均相电压（理想）', expression: 'Va = (Da - 0.5) × Udc', explanation: 'Da 是上桥臂占空比 [0,1]，以母线中点为参考。Da=0.5 → Va=0；Da=1 → Va=+Udc/2。' },
      { title: '死区损失', expression: 'ΔV_dt = td × fpwm × Udc × sign(Iphase)', explanation: '电流流入电机时上管"少导通"td，电流流出时下管"少导通"td。损失正比于死区时间和频率。' },
      { title: '过调制阈值', expression: '|Vphase| > 0.5 × Udc → 部分 PWM 周期 duty 撞 0 或 1', explanation: 'SVPWM 线性区单相幅值 ≈ Udc/√3 ≈ 0.577·Udc。继续增大就有 duty 被钳位。' },
      { title: '死区补偿', expression: 'Va_cmd = Va_ref + ΔV_dt × sign(Ia)', explanation: '提前在 PWM 命令上加补偿值；电流过零附近补偿不准（极性翻转），靠抑制电流过零段抖动。' },
    ],
    engineeringMeaning: ['死区是必要的保护代价。td 太大低速畸变重；太小直通烧管，需要按驱动器和管子手册定。', '硬件保护：刹车输入（BKIN）+ 过流比较器（COMP）+ 失能 PWM，软件中断兜底。', '电机参数中的相电压标定（Vphase / Udc）必须和你的逆变器拓扑一致——星型相电压 vs 线电压差 √3 倍。'],
    stm32Guide: ['TIM1/TIM8 高级定时器互补 PWM：CCxE = 1, CCxNE = 1，死区在 BDTR.DTG 寄存器（步长查 RM）。', '刹车 BKIN 接过流比较器输出（COMP），一旦触发硬件直接 OFF 全部 PWM，无需 CPU。', '调试顺序：先空载只接逆变器看 PWM 互补 + 死区，再低压 12V 接电机，最后母线 48V。'],
    commonMistakes: ['忘记 enable 互补输出极性（CCxNE）。', '死区过大（>5μs）低速波形严重畸变啸叫。', '没有硬件过流保护，软件来不及救。', '上电瞬间 PWM 占空比未初始化为 0.5，触发母线冲击。'],
    debugMethods: ['先逻辑分析仪抓 PWM_A 高侧 + 低侧，确认互补 + 死区 td 测量值符合设置。', '示波器抓相电压（电机断开时直接看半桥中点）应是干净方波。', '上电机低压（12V），抓三相电流应正弦对称；不对称 → 检查死区补偿和 ADC 偏置。'],
    experiments: ['死区 0.5μs vs 4μs，对比线电压顶部凹槽深度。', 'PWM 频率 4kHz vs 32kHz，看死区在周期内占比对失真的影响。', '占空比拉到 0.95，看进入过调制后的扭曲。'],
    summary: '逆变器是算法 → 真实电机的功率桥梁。理想模型简洁，但死区 / 过流 / 直通保护是工程必须做对的事。',
    nextSteps: ['进入三闭环模块，看电流环 / 速度环 / 位置环如何级联给逆变器下命令。'],
    codeExample: `/* ============================================
 * inverter_init.c — STM32G4 TIM1 三相互补 + 死区 + 刹车
 * ============================================ */

#define PWM_FREQ_HZ      16000
#define DEAD_TIME_NS     1000      // 1 μs，按驱动器手册调
#define APB2_CLOCK_HZ    170000000 // G4 主频

void inverter_pwm_init(void) {
    /* 1. TIM1 时钟 */
    RCC->APB2ENR |= RCC_APB2ENR_TIM1EN;

    /* 2. 中心对齐 PWM，ARR = clock / freq / 2 (因为中心对齐计数翻倍) */
    TIM1->PSC = 0;
    TIM1->ARR = APB2_CLOCK_HZ / PWM_FREQ_HZ / 2 - 1;
    TIM1->CR1 |= TIM_CR1_CMS_0;     // 中心对齐 mode 1（向上时更新比较）

    /* 3. PWM mode 1 三通道 + 互补输出 */
    TIM1->CCMR1 |= (6 << TIM_CCMR1_OC1M_Pos) | TIM_CCMR1_OC1PE;
    TIM1->CCMR1 |= (6 << TIM_CCMR1_OC2M_Pos) | TIM_CCMR1_OC2PE;
    TIM1->CCMR2 |= (6 << TIM_CCMR2_OC3M_Pos) | TIM_CCMR2_OC3PE;
    TIM1->CCER  |= TIM_CCER_CC1E | TIM_CCER_CC1NE
                 | TIM_CCER_CC2E | TIM_CCER_CC2NE
                 | TIM_CCER_CC3E | TIM_CCER_CC3NE;

    /* 4. 死区 + 主输出使能（BDTR）
     *    DTG[7:5]=0xx → DT = DTG × tCK_INT
     *    1μs @ 170MHz → DTG ≈ 170 (0xAA) */
    uint32_t dtg = (uint32_t)((uint64_t)DEAD_TIME_NS * APB2_CLOCK_HZ / 1000000000ULL);
    if (dtg > 127) dtg = 127;       // 简单上限，更高需切高位编码
    TIM1->BDTR = TIM_BDTR_MOE | (dtg & 0xFF);

    /* 5. 刹车输入 BKIN（接过流比较器输出，下降沿触发关断） */
    TIM1->BDTR |= TIM_BDTR_BKE | TIM_BDTR_BKP;

    /* 6. 初始占空比 50%，避免上电冲击 */
    TIM1->CCR1 = TIM1->ARR / 2;
    TIM1->CCR2 = TIM1->ARR / 2;
    TIM1->CCR3 = TIM1->ARR / 2;

    /* 7. 中断（更新事件触发 ADC 注入） */
    TIM1->DIER |= TIM_DIER_UIE;
    NVIC_SetPriority(TIM1_UP_TIM16_IRQn, 0);
    NVIC_EnableIRQ(TIM1_UP_TIM16_IRQn);

    /* 8. 启动 */
    TIM1->CR1 |= TIM_CR1_CEN;
}

/* 中断里写 CCR：
 *   TIM1->CCR1 = (uint16_t)(duty_a * (TIM1->ARR + 1));
 * BKIN 触发后 MOE=0，所有 PWM 强制低，无需 CPU。
 */`,
    quiz: [
      {
        q: '同一桥臂上下管同时导通会发生什么？',
        options: ['正常工作', '直通短路，瞬间炸管', '只是输出错误', '保护自动启动'],
        correct: 1,
        hint: '上下管同时开 = 母线 + 经过两个管子直接接地，瞬态短路电流毫秒级烧毁。死区时间就是为了避免这个。',
      },
      {
        q: '死区时间 td = 2μs，PWM 频率 16kHz，占空比 50% 时一个周期"丢失"的导通时间占比？',
        options: ['约 0.4%', '约 3.2%', '约 32%', '约 50%'],
        correct: 1,
        hint: '一个周期 62.5μs，死区 2μs 占 3.2%。低速小电流时这部分电压损失明显。',
      },
      {
        q: 'STM32 高级定时器 TIM1 的"刹车输入 BKIN"作用是？',
        options: ['启动 PWM', '硬件触发后立刻关断所有 PWM 输出，无需 CPU 介入', '改变频率', '复位定时器'],
        correct: 1,
        hint: '过流时硬件比较器输出接到 BKIN，触发后 MOE 寄存器自动清零，所有 PWM 强制低。CPU 中断只是事后处理。',
      },
      {
        q: '低速小电流时电机啸叫，最可能的根因是？',
        options: ['Kp 太大', '死区时间过大造成低速电压畸变', 'PWM 频率太低', '编码器分辨率不够'],
        correct: 1,
        hint: '死区损失 ΔV 与 td × fpwm 成正比，电流过零附近电压扭曲。可缩短死区或加死区补偿算法。',
      },
      {
        q: '上电瞬间发现母线大冲击电流。检查代码，PWM CCR 初始化值是多少最安全？',
        options: ['0', 'ARR (= 100%)', 'ARR/2 (= 50%)', '随便'],
        correct: 2,
        hint: 'CCR=0 → 上桥常闭、下桥常开，下桥电流通过电机绕组到地，无电压差。最安全的是 ARR/2 (50%) → 三相中点电压都等于 Udc/2，相间无电压。',
      },
    ],
  },
  'control-loops': {
    id: 'control-loops',
    introBeginner: {
      metaphor: '三闭环就像三层套娃：**位置环**（你想去 3 楼）→ **速度环**（电梯先上升再减速）→ **电流环**（电机出多大力气）。外层告诉内层"目标变多少"，内层迅速执行；外层永远比内层慢，否则就抢着指挥乱套。',
      coreIdea: '三层级联控制：位置环 → 给速度命令 → 速度环 → 给电流命令 → 电流环 → 给电压命令。带宽自外向内逐层增大（5-10 倍），整定顺序自内向外。',
      whyCare: [
        '伺服、机器人关节、CNC 都用三闭环结构。少一层不行（响应慢）、多一层无意义。',
        '"先调速度环，电流环还没整定好"是新人最常见的翻车——内环不稳，外环再调都白搭。',
        '内外环带宽差 5-10 倍是经验法则，违反就是振荡跑飞或响应慢得无法接受。',
      ],
      firstAction: '右侧把"位置环 Kp"从 3.5 慢慢推到 12，看电机从平稳到达目标位置变成"过冲后回弹再过冲"。再切到"速度环 Kp"从 0.08 推到 0.4，看电机进入持续高频振荡——内外环都过激。',
    },
    learningGoals: ['理解电流环、速度环、位置环的层级关系', '掌握"内环快、外环慢"的物理原因', '学会从内到外的整定顺序'],
    concepts: ['电流环最里层，直接控转矩，带宽 1-5 kHz；速度环中层，输出 Iq 参考，带宽 100-500 Hz；位置环最外，输出速度参考，带宽 10-50 Hz。', '外环带宽必须 ≪ 内环带宽（5-10×），否则外环命令变化太快内环跟不上，互相打架振荡。', '每环输出都要限幅（电流限、速度限、加速度限）。'],
    formulas: [
      { title: '三闭环级联结构', expression: '位置 PID → 速度 PI → 电流 PI → 反 Park → SVPWM → 桥臂', explanation: '每层输出下一层的参考值；执行频率逐层降低（电流 PWM 同频，速度 1-2kHz，位置 100-500Hz）。' },
      { title: '电流环带宽估算', expression: 'ω_bw_i ≈ Kp / L', explanation: 'Kp 为电流 PI 比例增益，L 为电感。电流环 1kHz 带宽对应 Kp ≈ 7.5（L = 1.2mH）。' },
      { title: '速度环带宽匹配', expression: 'ω_bw_s ≤ ω_bw_i / (5~10)', explanation: '电流环 1kHz → 速度环最多 100-200Hz。再快就开始振荡。' },
      { title: '位置环 + 前馈', expression: 'Vref = Kp_p·(Pref-P) + Vref_ff', explanation: '位置环输出速度参考；加速度前馈 Vref_ff 直接前馈电流命令，可大幅提升跟踪精度。' },
    ],
    engineeringMeaning: ['工业伺服必须分清三层。CNC 加工、机械臂关节、压缩机变频都依赖这套架构。', '内环带宽决定上限。电机电感大就带宽低，对应外环必须更慢；选电机和驱动器要看电感。', '前馈大幅提升跟踪精度。速度前馈 + 加速度前馈在伺服里很常见，让位置环稳态接近零误差。'],
    stm32Guide: ['电流环放 PWM 中断（16-20kHz），速度环放 1-2kHz 软件定时器，位置环放 100-500Hz。', '每环输出立刻限幅（电流不超 IMAX、速度不超 SPMAX、加速度不超 AMAX）。', '调试用 RTT/示波器同时记录位置参考、实际位置、速度参考、实际速度、Iq 参考、Iq 实际，看 6 路曲线对照。'],
    commonMistakes: ['先调外环还没整定内环。', '内外环同频同高带宽 → 必振荡。', '外环输出未限幅 → 电流命令瞬间冲过电机能力上限。', '没考虑机械惯量 J 直接用经验值。'],
    debugMethods: ['整定顺序严格：电流环 → 速度环 → 位置环。', '电流环：给 Iq 阶跃，看上升时间和超调。', '速度环：固定位置环输出（或开环），给小速度阶跃，看跟踪。', '位置环：最后才上，用慢速度斜坡而非阶跃。'],
    experiments: ['位置环 Kp 推到 12，看过冲振荡。', '速度环 Kp 推到 0.4 配合电流环 Kp=2，看叠加振荡。', '负载转矩从 0.08 推到 0.5，看稳态误差和电流余量。'],
    summary: '三闭环不是"环越多越强"，而是"每层比外层更快、限幅更严"。整定靠纪律不靠玄学。',
    nextSteps: ['进入无感 FOC，处理"没有编码器时角度从哪儿来"。'],
    codeExample: `/* ============================================
 * triple_loop.c — 三闭环级联调度
 * 不同环路在不同频率执行
 * ============================================ */
#include "pi.h"

/* 三个 PI 控制器实例 */
static pi_t pi_iq;          // 电流环 (16 kHz)
static pi_t pi_speed;       // 速度环 (2 kHz)
static pi_t pi_position;    // 位置环 (200 Hz)

/* 状态：参考与限幅 */
static float ref_position_deg;
static float ref_speed_rpm;
static float ref_iq_a;

/* 系统限制 */
#define IQ_MAX_A          8.0f
#define SPEED_MAX_RPM     5000.0f
#define ACCEL_MAX_RPMS    20000.0f      // rpm/s

void triple_loop_init(void) {
    /* 电流环：高带宽，PWM 同频 */
    pi_init(&pi_iq, 1.6f, 220.0f, 1.0f/16000.0f, -IQ_MAX_A * 4.0f, IQ_MAX_A * 4.0f);
    /* 速度环：内环 1/8，2 kHz */
    pi_init(&pi_speed, 0.08f, 0.8f, 1.0f/2000.0f, -IQ_MAX_A, IQ_MAX_A);
    /* 位置环：外环 1/10，200 Hz */
    pi_init(&pi_position, 3.5f, 0.2f, 1.0f/200.0f, -SPEED_MAX_RPM, SPEED_MAX_RPM);
}

/* PWM 中断 (16 kHz) — 只跑电流环 */
void TIM1_UP_IRQHandler(void) {
    float v_q = pi_step(&pi_iq, ref_iq_a, g_state.iq);
    /* ... 反 Park, SVPWM ... */
}

/* 软件定时器 (2 kHz) — 速度环 */
void speed_loop_tick(void) {
    /* 速度斜坡限幅，避免电流命令突变 */
    static float ref_speed_lim = 0;
    float dv = ref_speed_rpm - ref_speed_lim;
    float dv_max = ACCEL_MAX_RPMS / 2000.0f;
    if (dv >  dv_max) dv =  dv_max;
    if (dv < -dv_max) dv = -dv_max;
    ref_speed_lim += dv;

    ref_iq_a = pi_step(&pi_speed, ref_speed_lim, g_state.speed_rpm);
}

/* 软件定时器 (200 Hz) — 位置环 */
void position_loop_tick(void) {
    ref_speed_rpm = pi_step(&pi_position, ref_position_deg, g_state.position_deg);
}

/* === 整定步骤 ===
 * 1. 把外环（速度、位置）输出强行清零或开环，先只跑电流环；
 *    给 Iq 阶跃 (1A→3A)，调 Kp 到刚开始振荡，取 0.5 倍。
 * 2. 启用速度环，位置环输出仍清零；给小速度阶跃 (100→500 rpm)，
 *    调 speed Kp 到响应快但不振荡。
 * 3. 启用位置环；给斜坡位置目标，调 position Kp。
 */`,
    quiz: [
      {
        q: '三闭环整定的正确顺序？',
        options: ['位置→速度→电流', '速度→位置→电流', '电流→速度→位置', '随便'],
        correct: 2,
        hint: '从内向外。内环不稳定，外环再怎么调都没用——外环命令送给一个不靠谱的内环，结果一样烂。',
      },
      {
        q: '电流环带宽 1 kHz，速度环带宽多少最稳？',
        options: ['同 1 kHz', '500 Hz', '100-200 Hz', '5 kHz'],
        correct: 2,
        hint: '外环带宽 = 内环 / 5-10。1kHz 内环 → 速度环 100-200 Hz 最稳。同频或更快会振荡。',
      },
      {
        q: '位置环输出未限幅，给一个大位置阶跃会发生什么？',
        options: ['正常到位', '速度命令瞬间冲到上千 rpm，超出电机能力', '电流降低', '位置环停止'],
        correct: 1,
        hint: 'Kp_p × 大误差 = 大速度命令，可能超出电机最大转速 → 速度环输出大 Iq → 撞电流限或过流保护。每环输出必须限幅。',
      },
      {
        q: '伺服电机加速度前馈的作用？',
        options: ['没用', '把"理想加速所需的电流"提前直接喂给电流环，减小位置/速度环负担，提高跟踪精度', '保护硬件', '降低噪声'],
        correct: 1,
        hint: '反馈控制是"事后纠偏"，前馈是"提前预知"。已知运动轨迹时前馈 Iq_ff = J·dω/dt 直接给到电流环参考，跟踪精度大幅提升。',
      },
      {
        q: '电机机械惯量 J 增大 4 倍，速度环 Kp 大约该怎么调？',
        options: ['不变', '增大 4 倍', '减小 4 倍', '随便'],
        correct: 1,
        hint: '速度环面对的"被控对象增益"反比于 J（同样 Iq 加速度变小）。要保持闭环带宽不变，Kp 也要相应增大。',
      },
    ],
  },
  'sensorless-foc': {
    id: 'sensorless-foc',
    introBeginner: {
      metaphor: '无感 FOC 像在黑暗中用回声定位——没有编码器（眼睛），靠"听"反电动势的回声来判断转子在哪儿。回声大（高速）听得清；回声小（低速）就被噪声淹没，得先盲推一段时间（开环启动）等回声出现再切闭环。',
      coreIdea: '无感不是没有角度，而是用电压、电流、电机模型估算角度。低速反电动势小，估算不可靠；高速精度高。常见方案：开环启动 → 反电动势观测器 → PLL 锁相得角度。',
      whyCare: [
        '风机、水泵、压缩机、家电都用无感 FOC（省一个编码器 = 省成本 + 简化结构）。',
        '"电机不转""低速失步""切换瞬间抖动"绝大多数源于角度估算质量。',
        '理解 BEMF 和 PLL 后才知道为什么风机厂商规定"启动时一定要先开环转 1 秒"。',
      ],
      firstAction: '右侧把"转速"从 450 rpm 拉到 2000 rpm，看左侧"PLL 锁相"图：估算角度（蓝）从大幅滞后真实角度（绿）变成几乎重合。下方"BEMF αβ" 波形振幅明显增大——回声变大，定位变准。',
    },
    learningGoals: ['区分有感 FOC 与无感 FOC', '理解反电动势观测器和 PLL 的工作原理', '学会"开环启动 → 闭环切换"的工程套路'],
    concepts: ['反电动势 BEMF = Ke·ω，正比于转速。低速 BEMF 小，被 ADC 噪声 + Rs/Ls 参数误差掩盖，估算不可靠。', 'PLL = Phase-Locked Loop，是把"测量角度"通过 PI 锁相变成"平滑跟踪角度"，过滤噪声。', '工程套路：上电先开环 V/f 拖到目标速度（典型 30-50% 额定）→ 等观测器置信度上去 → 平滑切到闭环。'],
    formulas: [
      { title: '反电动势观测', expression: 'eα = vα − R·iα − L·diα/dt\\neβ = vβ − R·iβ − L·diβ/dt', explanation: '从 αβ 电压扣除电阻压降和电感压降，剩下的是 BEMF。Rs/Ls 参数错会直接影响精度。' },
      { title: '角度提取', expression: 'θ_est = atan2(eα, −eβ)', explanation: 'BEMF 矢量领先转子磁链 90°；用 atan2 求角后修正 90° 得到电角度。' },
      { title: 'PLL 锁相', expression: 'Δθ = sin(θ_meas − θ_est)\\nω_est = Kp·Δθ + ∫(Ki·Δθ)dt\\nθ_est ← θ_est + ω_est·dt', explanation: 'PI 控制器追相位差。低速时增大 Kp/Ki 加快收敛但增加抖动。' },
      { title: 'SMO 滑模观测器', expression: 'di_est/dt = (1/L)·(v − R·i_est − Z·sign(i_est − i_meas))', explanation: '滑模等效控制项 Z·sign(...) 经低通滤波后近似 BEMF。鲁棒性好，但有抖振。' },
    ],
    engineeringMeaning: ['低速时 BEMF 信号比噪声小→必须开环启动。500 rpm 是经验阈值。', 'Rs/Ls 参数标定不准 → 估算 BEMF 偏差 → 角度有恒定偏移。生产线必做参数辨识。', '负载突变（开闭环切换、负载冲击）会让 PLL 暂时失锁——需要"健康检查"自动回退到开环。'],
    stm32Guide: ['离散化用前向欧拉就够（Ts = PWM 周期）；高带宽场景用 Tustin。', 'L·diα/dt 用 (iα[k] − iα[k-1]) / Ts，但要先加 Butterworth 低通去高频噪声。', '上电流程：1) 对齐 d 轴 → 2) 开环 V/f 拖动 → 3) 监测 PLL 收敛（角度误差 < 5° 持续 20ms）→ 4) 切闭环。'],
    commonMistakes: ['低速强行闭环，BEMF 太小 PLL 锁不住，电机抖动甚至反转。', '观测器增益过高 → 角度抖到电流环噪声放大。', '没加 PLL 健康检查，故障情况继续按估算角度送电流→烧管。', '把开环 V/f 启动的电压设得过大或过小，电机失步。'],
    debugMethods: ['临时装个编码器对比：估算角度 vs 真实角度，画误差曲线。', '观察 BEMF αβ 波形是否对称正弦。畸变 → 检查 Rs/Ls 参数和死区补偿。', '阶跃负载，看 PLL 恢复时间（应 < 50ms）；恢复慢 → Kp/Ki 偏低。'],
    experiments: ['速度从 450 rpm 拉到 2000 rpm，看 PLL 锁相质量变化。', '把"噪声"参数从 0.08 拉到 0.5，看角度估算抖动加剧。', '把 PLL Kp/Ki 加倍，看 BEMF 噪声直接放大到角度。'],
    summary: '无感 FOC 核心是"角度可信度管理"——什么时候可信、什么时候必须回退到开环。算法只是其中一环。',
    nextSteps: ['进入弱磁控制，看高速无感场景下电压余量怎么换更高速度。'],
    codeExample: `/* ============================================
 * smo_pll.c — 滑模观测器 + PLL 锁相
 * 简化教学版，工程版需要参数辨识 + 健康检查
 * ============================================ */
typedef struct {
    /* 电机参数 */
    float rs;       // Ω
    float ls;       // H
    float ke;       // V·s/rad

    /* SMO 状态 */
    float i_alpha_est, i_beta_est;
    float z_alpha_filtered, z_beta_filtered;  // 等效 BEMF
    float smo_gain;
    float lpf_alpha;     // 低通系数 = Ts·ωc / (1+Ts·ωc)

    /* PLL 状态 */
    float pll_kp, pll_ki;
    float pll_integral;
    float omega_est;     // rad/s
    float theta_est;     // rad
} sensorless_t;

static inline float sat_unit(float x) { return x > 1.0f ? 1.0f : (x < -1.0f ? -1.0f : x); }

void sensorless_step(sensorless_t *s,
                     float v_alpha, float v_beta,
                     float i_alpha_meas, float i_beta_meas,
                     float dt)
{
    /* 1. 滑模观测器：电流模型 + 等效控制项 */
    float di_alpha = (v_alpha - s->rs * s->i_alpha_est) / s->ls;
    float di_beta  = (v_beta  - s->rs * s->i_beta_est)  / s->ls;

    /* 等效 BEMF 项：error 经过 sat 限幅替代 sign，平滑抖振 */
    float err_a = sat_unit((s->i_alpha_est - i_alpha_meas) * 5.0f);
    float err_b = sat_unit((s->i_beta_est  - i_beta_meas)  * 5.0f);
    float z_alpha = -s->smo_gain * err_a;
    float z_beta  = -s->smo_gain * err_b;

    s->i_alpha_est += (di_alpha + z_alpha / s->ls) * dt;
    s->i_beta_est  += (di_beta  + z_beta  / s->ls) * dt;

    /* 2. 低通滤掉抖振，得到平滑 BEMF */
    s->z_alpha_filtered += s->lpf_alpha * (z_alpha - s->z_alpha_filtered);
    s->z_beta_filtered  += s->lpf_alpha * (z_beta  - s->z_beta_filtered);

    /* 3. PLL 锁相：Δθ = sin(θ_meas - θ_est)
     *    用 BEMF 反算 θ_meas = atan2(z_α, -z_β)，但避免 atan2 抖动用 sin 误差形式 */
    float sin_dtheta = -s->z_beta_filtered  * cosf(s->theta_est)
                       -s->z_alpha_filtered * sinf(s->theta_est);
    /* 标定到 [-1, 1]: 除以 BEMF 估算幅值 */
    float bemf_amp = sqrtf(s->z_alpha_filtered * s->z_alpha_filtered
                         + s->z_beta_filtered  * s->z_beta_filtered) + 1e-6f;
    sin_dtheta /= bemf_amp;
    sin_dtheta = sat_unit(sin_dtheta);

    /* PI 锁相 */
    s->pll_integral += s->pll_ki * sin_dtheta * dt;
    s->omega_est = s->pll_kp * sin_dtheta + s->pll_integral;

    /* 角度积分 */
    s->theta_est += s->omega_est * dt;
    if (s->theta_est >  M_PI) s->theta_est -= 2.0f * M_PI;
    if (s->theta_est < -M_PI) s->theta_est += 2.0f * M_PI;
}

/* 健康检查（在主循环慢任务中跑）：
 *   - BEMF 幅值 < 阈值 → 切回开环
 *   - 角度误差 |Δθ| > 阈值持续 20ms → 切回开环
 *   - 估算 ω_est 与命令速度偏差过大 → 报警
 */`,
    quiz: [
      {
        q: '为什么无感 FOC 必须有"开环启动"阶段？',
        options: ['硬件要求', '低速时 BEMF 信号被噪声淹没，无法估算角度', '让用户耐心等待', '降低成本'],
        correct: 1,
        hint: 'BEMF = Ke·ω 正比于转速。低速（< 500rpm）BEMF 几乎为零，全是 Rs/Ls 参数误差和 ADC 噪声，角度估不出来。先用开环 V/f 把电机拖到一定速度再切闭环。',
      },
      {
        q: '反电动势观测公式 e = v − Ri − L·di/dt 中，最易导致角度偏移的参数误差是？',
        options: ['v', 'R', 'L', '都不影响'],
        correct: 1,
        hint: 'R 直接乘电流，误差直接进 BEMF。L 影响 di/dt 项，电流变化率小时影响弱。生产线参数辨识第一项就是 Rs。',
      },
      {
        q: 'PLL 锁相中 Kp/Ki 加大的副作用？',
        options: ['没影响', '锁相更快但角度抖动放大（噪声经过 PI 直接进 θ）', '降低带宽', '失锁'],
        correct: 1,
        hint: 'PI 增益越大跟踪越快，但同时放大输入端的噪声（BEMF 估算抖动）。在低速噪声大时尤其敏感，需要折中。',
      },
      {
        q: '滑模观测器 (SMO) 的"等效控制项"为什么要经过低通滤波？',
        options: ['硬件要求', 'sign() 切换函数本身有高频抖振，滤掉抖振才得到平滑 BEMF', '减少计算量', '修正 Rs'],
        correct: 1,
        hint: 'SMO 让估算电流强制收敛到测量值，依靠 sign(error) 切换。这个切换以采样频率抖动，必须低通才能从中提取 BEMF 平均值作为角度信息源。',
      },
      {
        q: '从开环切到闭环的最佳判据？',
        options: ['等 1 秒', 'BEMF 幅值 ≥ 阈值 + PLL 角度误差 < 5° 持续 ≥ 20ms', '检测电流稳定', '速度命令到达'],
        correct: 1,
        hint: '切换条件应基于"估算质量"——BEMF 信噪比够高 + PLL 已稳定锁相一段时间。光看时间不够，遇到启动失步会把电机拖跑了。',
      },
    ],
  },
  'field-weakening': {
    id: 'field-weakening',
    introBeginner: {
      metaphor: '弱磁就像汽车上**自动换挡**——低速齿轮（1 档）扭矩大但速度上限低；高速时换 4 档，扭矩变小但能跑更快。电机里"档位"不是机械的，是电气的：通过注入负 Id 削弱永磁磁链，让反电动势降下来，给逆变器输出腾出电压余量。',
      coreIdea: '高速时 BEMF = Ke·ω 接近母线电压上限，电流环没电压可用，输出饱和。注入 −Id 削弱等效磁链 → BEMF 减小 → 电压余量恢复 → 还能再上速度（代价：转矩下降）。',
      whyCare: [
        '电动车电机、伺服主轴、压缩机想跑高速必弱磁，否则 BEMF 撞母线就转不上去。',
        '"为什么我电压拉满了电流也加了，速度就是上不去"——99% 是没做弱磁。',
        '弱磁 ↔ 退磁是一线之隔，负 Id 过大伤永磁体，工程要严格设上限。',
      ],
      firstAction: '右侧把"目标转速"从 4200 rpm 推到 8000 rpm，看左下角红色警告"电压饱和"亮起。然后把 Id 拖到 -3A，看红色椭圆（电压极限）变大；继续 -5A，警告消失，进入安全工作区。',
    },
    learningGoals: ['理解为什么高速需要弱磁', '掌握电流极限圆 + 电压极限椭圆 + Id/Iq 工作点的几何关系', '区分恒转矩区 / 恒功率区 / MTPA / MTPV'],
    concepts: ['电流极限圆：|I| = √(Id² + Iq²) ≤ I_max。电流硬限。', '电压极限椭圆：√(Vd² + Vq²) ≤ Udc/√3。频率越高椭圆越扁（中心向 −Id 方向移）。', '工作点必须在两条曲线**同时围成的区域**内。低速时电流圆小先撞，高速时电压椭圆收缩先撞。', '弱磁就是把工作点沿 −Id 方向滑动，让它进入"较小的电压椭圆"内。'],
    formulas: [
      { title: 'PMSM 稳态电压方程（dq）', expression: 'Vd = R·Id − ω·Lq·Iq\\nVq = R·Iq + ω·(Ld·Id + ψf)', explanation: '高速时 R·I 项 ≪ ω·L·I 项，电压基本由"反电动势 + 交叉耦合"决定。' },
      { title: '电压幅值', expression: '|V| = √(Vd² + Vq²) ≤ V_max = Udc/√3', explanation: 'V_max 是 SVPWM 线性区上限。超出 → 过调制 → 电流环失控。' },
      { title: 'BEMF 抵消（弱磁条件）', expression: '−ω·Ld·Id ≈ ω·ψf', explanation: '负 Id 让"等效磁链 ψf + Ld·Id"变小，反电动势降低，腾出电压。' },
      { title: 'MTPA / MTPV', expression: 'MTPA: Iq² + (Lq−Ld)·Id·Iq − ψf·Id = 0\\nMTPV: 沿电压椭圆边界优化 Iq', explanation: 'MTPA = 同电流下最大转矩；MTPV = 同电压下最大转矩。前者用于低速，后者用于深度弱磁。' },
    ],
    engineeringMeaning: ['弱磁是电压预算管理。低速恒转矩、中速进入弱磁、高速恒功率。', '负 Id 上限由两个约束确定：电流圆（|I| ≤ I_max）+ 退磁阈值（厂家给）。永磁体退磁不可逆。', '弱磁切换要平滑——开环 PI 控制电压幅值（让它紧贴 V_max），自动调节 Id 大小。'],
    stm32Guide: ['弱磁 PI 控制器：误差 = V_max − |V|，输出 Id 命令（取负）。', '工作点检测：每个慢任务周期算一次 |V| 和 |I|，超限报警。', 'V_max 留 5-10% 余量（用 0.95·Udc/√3）防止抖动撞限。'],
    commonMistakes: ['只加目标速度不检查电压余量，电流环输出长期撞限。', '负 Id 加得过大 → 电流圆撞限 + 退磁风险。', '弱磁 PI 增益过大 → Id 命令震荡 → 转矩抖动。', '没设最低速度阈值 → 低速也启用弱磁，无谓损耗。'],
    debugMethods: ['画 Id/Iq 工作点 + 电流圆 + 电压椭圆，看实际位置。', '观察 |V_dq| 与 V_max 的比值——> 0.95 触发弱磁。', '记录进入/退出弱磁前后的转矩、电流、母线电压，计算效率。'],
    experiments: ['不动 Id，把目标转速从 4200 推到 8000 → 看电压饱和警告。', '加大 Iq → 转矩上升但电压更先饱和；加 −Id 反而能推到更高速。', 'Udc 从 48V 降到 24V，看电压椭圆缩小一半，弱磁需求大幅提前。'],
    summary: '弱磁 = 用一部分电流"买"电压余量，是高速运行不可绕开的电压预算管理。',
    nextSteps: ['进入故障调试模块，把所有学过的诊断技能串起来。'],
    codeExample: `/* ============================================
 * field_weakening.c — 自动弱磁控制（电压幅值闭环）
 * 输出 Id 命令给电流环
 * ============================================ */
#include "pi.h"

typedef struct {
    pi_t pi_fw;            // 弱磁 PI（输入：电压余量误差，输出：Id 命令）
    float v_max;           // SVPWM 线性区上限 = 0.95 × Udc/√3
    float id_min;          // 最负 Id 上限（退磁安全 + 电流圆）
    float i_max;           // 电流圆 |I| ≤ I_max
    float deadband;        // |V|/V_max < 该值不弱磁
} fw_ctrl_t;

void fw_init(fw_ctrl_t *f, float udc, float i_max, float id_min) {
    f->v_max = 0.95f * udc * 0.57735027f;     // 1/√3
    f->id_min = id_min;
    f->i_max = i_max;
    f->deadband = 0.93f;     // 在 95% 之前不动作

    /* 弱磁 PI：误差大时快速注入 Id（负方向） */
    pi_init(&f->pi_fw, 0.5f, 100.0f, 1.0f/2000.0f,
            id_min,    /* out_min: 最大负 Id */
            0.0f);     /* out_max: 不主动注入正 Id */
}

/* 输入：当前 Vd / Vq，当前 Iq；输出：Id 参考 */
float fw_compute_id_ref(fw_ctrl_t *f, float vd, float vq, float iq_ref) {
    float v_mag = sqrtf(vd*vd + vq*vq);
    float v_ratio = v_mag / f->v_max;

    /* 死区内不动作 */
    if (v_ratio < f->deadband) {
        pi_reset(&f->pi_fw);
        return 0.0f;
    }

    /* 误差 = 1.0 - 当前比值（负值表示已超限，需要更负 Id） */
    float err = 1.0f - v_ratio;
    float id_ref = pi_step(&f->pi_fw, 0.0f, -err);    /* 注：符号约定 */

    /* 电流圆约束：|Id|² + Iq² ≤ I_max² */
    float iq_sq = iq_ref * iq_ref;
    float id_max_circle = -sqrtf(f->i_max * f->i_max - iq_sq);
    if (id_ref < id_max_circle) id_ref = id_max_circle;

    return id_ref;
}

/* 用法（在速度环之后、电流环之前）：
 *   id_ref = fw_compute_id_ref(&fw, vd_last, vq_last, iq_ref);
 *   // 现在 id_ref + iq_ref 进入电流环
 *
 * === 调试要点 ===
 * 1. v_max 必须留余量（90-95%），否则在边界震荡
 * 2. id_min 由两条线决定：电流圆 + 退磁阈值（取严的那条）
 * 3. PI 增益太大 → Id 命令震荡 → 转矩抖动；太小 → 弱磁响应慢
 */`,
    quiz: [
      {
        q: '高速时电流环输出 |V| 撞限，电机不再加速。最直接的解决方案？',
        options: ['加大 Iq', '注入负 Id 削弱磁链', '提高 PWM 频率', '降低控制带宽'],
        correct: 1,
        hint: '负 Id 让等效磁链 ψf + Ld·Id 变小 → BEMF 降低 → 电压余量恢复 → 速度还能再上。',
      },
      {
        q: '电流极限圆和电压极限椭圆，哪个对低速不构成约束？',
        options: ['电流圆', '电压椭圆', '都构成', '都不构成'],
        correct: 1,
        hint: '低速 ω 小，电压椭圆很大，包住整个电流圆。电流圆才是低速时的硬限。高速 ω 大，椭圆收缩到电流圆内部，先撞。',
      },
      {
        q: '负 Id 加到极大可能造成的不可逆危害？',
        options: ['过流', '过压', '永磁体退磁（磁性永久损失）', '过热'],
        correct: 2,
        hint: '深度负 Id 产生的反向磁场如果超过永磁体矫顽力，磁性永久减弱（退磁）。每个永磁电机都有退磁阈值（厂家给），工程上 Id 限制必须严格守这条线。',
      },
      {
        q: 'MTPA（最大转矩电流比）控制策略适用什么阶段？',
        options: ['低速恒转矩区', '高速弱磁区', '深度弱磁区', '所有区域'],
        correct: 0,
        hint: 'MTPA = 同样电流幅值下产生最大转矩。在没撞电压限的恒转矩区效率最优。撞了电压限就要切换到弱磁（恒功率）区策略。',
      },
      {
        q: '母线电压 Udc 从 48V 降到 24V，弱磁开始介入的转速大约怎么变？',
        options: ['不变', '提高一倍', '降低一半', '提高一倍开方'],
        correct: 2,
        hint: 'V_max 与 Udc 成正比，电压椭圆半径缩一半。BEMF = Ke·ω 撞 V_max 时 ω 也减半，所以弱磁介入速度对半。',
      },
    ],
  },
  'faults-debugging': {
    id: 'faults-debugging',
    introBeginner: {
      metaphor: '故障调试像医生看病——不是看症状（"电机抖动"），而是要把"症状 → 波形 → 中间变量 → 硬件测量"串成一条证据链。每个故障在波形上都有典型特征，会看波形等于会做诊断。',
      coreIdea: '建立"现象库"：把 8 类常见故障（过流 / 缺相 / 偏置 / 相序 / 角度 / 振荡 / 饱和 / 启动失败）和它们的波形特征 + 排查步骤 + 修复方案对应起来。',
      whyCare: [
        '现场调试 80% 时间是定位故障，10% 在改代码。会看波形 = 会调电机。',
        '"低速啸叫" 可能是死区、PI 振荡、采样噪声、机械共振——同一现象多个原因。证据链思维让你不靠猜。',
        '工业项目交付前必须做 EFT/ESD/温度循环测试。预先做故障注入实验，能避免上线后的尴尬。',
      ],
      firstAction: '右侧切换"故障类型"试 8 种故障，看 Ia/Ib/Ic/speed 波形特征。每种故障右侧都有"现象 + 原因 + 排查步骤 + 修复建议"，这是真实现场的诊断手册。',
    },
    learningGoals: ['认识 8 类典型故障的波形特征', '建立"波形 → 原因 → 排查 → 修复"调试链', '把软件中间变量与现场示波器/逻辑分析仪测量对应起来'],
    concepts: ['故障 ≠ 报警码。同样"过流报警"可以是 PI 振荡、相序错、角度错、机械堵转、母线电容老化。', '同一现象可能多原因——啸叫可能 PI 振荡 / 死区 / 共振 / 采样噪声。逐一排除是诊断纪律。', '故障快照：触发瞬间记录 Ia/Ib/Ic/Id/Iq/Vd/Vq/duty/theta/speed/fault flags 一组，事后 RTT/串口回看。'],
    formulas: [
      { title: '调试黄金循环', expression: '现象 → 波形 → 中间变量 → 硬件测量 → 假设 → 修改 → 复测', explanation: '每次只改一个变量，保留复现实验。盲改多个会迷失。' },
      { title: '过流判据（软件）', expression: '|Ia| > I_OC 或 √(Iα²+Iβ²) > I_OC × 1.15', explanation: '软件保护 I_OC = 1.2 × I_rated；硬件保护通常 1.5-2 × I_rated 由比较器直接关 PWM。' },
      { title: '相序错诊断', expression: '正向命令但电机反转 / 同样 Iq 命令转矩偏向反向', explanation: '换接线两相 / 软件里 swap Ib 与 Ic 即可修复。' },
    ],
    engineeringMeaning: ['现场调试靠证据。把常见错做成案例库，新人上手时间从月级缩到周级。', '故障保护分硬件（比较器 + BKIN）和软件（中断检查 + 分级处理）两层。硬件兜底，软件辅助分类。', 'Black-box 数据：每次故障写 256 字节快照到 EEPROM，售后回收能快速定位。'],
    stm32Guide: ['故障快照结构体放在 RAM 末段（链接脚本指定地址），复位不清除。', '硬件保护：COMP + DAC 比较器输出接 TIM1 BKIN，配合 GPIO 故障 pin。', '分级保护：硬件 → 软件中断 → 主循环慢任务，每级处理时间预算从 < 1μs 到 1ms。'],
    commonMistakes: ['过流后只降 Kp 不查相序和角度。', '电压饱和时继续加 Iq 命令（无效且伤管）。', '只做软件保护，没硬件兜底——MCU 卡死了保护就没了。', '故障日志没保存，每次都凭印象。'],
    debugMethods: ['故障复现要从安全边界开始：12V 母线 + 限流 1A + 空载，逐步抬升参数。', '示波器 + 逻辑分析仪 + 串口三件套交叉验证。', '同样故障在不同 Kp/Ki/转速下复现 2-3 次，找规律。'],
    experiments: ['切换 8 种故障类型，看波形特征：过流的电流尖峰、缺相的某相消失、相序错的反向、角度错的高频抖动。', '调"故障严重度"看程度：从轻微（可工作）到严重（必须停机）。', '对照右侧"原因 / 排查 / 修复"建议，理解每种故障的诊断套路。'],
    summary: '故障调试的目标是把"感觉不对"翻译成"可测、可复现、可修复"。证据链 + 案例库是工程师最值钱的资产。',
    nextSteps: ['回到 FOC 流程模块，用单步方式定位每类故障出现在数据流哪一段。整门课闭环。'],
    codeExample: `/* ============================================
 * fault.c — 分级故障保护 + 黑匣子快照
 * 硬件保护 < 1μs，软件中断 < 50μs，主循环 < 10ms
 * ============================================ */

typedef enum {
    FAULT_NONE,
    FAULT_OVER_CURRENT,
    FAULT_OVER_VOLTAGE,
    FAULT_UNDER_VOLTAGE,
    FAULT_OVER_TEMP,
    FAULT_PHASE_LOSS,
    FAULT_ENCODER_LOST,
    FAULT_ANGLE_DIVERGENCE,
} fault_code_t;

/* === 黑匣子快照（链接脚本里放在掉电不丢的 RAM 段） === */
typedef struct __attribute__((packed)) {
    uint32_t magic;          // 0xDEADBEEF
    uint32_t timestamp_ms;
    fault_code_t code;
    float ia, ib, ic;
    float id, iq;
    float vd, vq;
    float duty_a, duty_b, duty_c;
    float theta_e;
    float speed_rpm;
    float udc;
    float temp_c;
    uint32_t crc32;
} fault_snapshot_t;

extern fault_snapshot_t __noinit_fault_snap __attribute__((section(".noinit")));

/* === 第一级：硬件保护（< 1μs，不靠 CPU） ===
 *   COMP1 比较 ADC4 (相电流) 和 DAC3 (1.8 × I_rated)，
 *   超限 → BKIN_N → TIM1 MOE=0 → PWM 全关。
 *
 * 在 BKIN 的 NMI 中只做：拍快照 + 设置 fault flag */
void NMI_Handler(void) {
    if (TIM1->SR & TIM_SR_BIF) {
        TIM1->SR &= ~TIM_SR_BIF;
        save_snapshot(FAULT_OVER_CURRENT);
        g_state.fault_pending = 1;
    }
}

/* === 第二级：软件保护（PWM 中断尾部，< 50μs） === */
void check_software_faults(void) {
    /* 过流（含限幅前的瞬时电流） */
    float i_mag = sqrtf(g_state.ialpha * g_state.ialpha
                       + g_state.ibeta * g_state.ibeta);
    if (i_mag > I_OC_SOFT) {
        save_snapshot(FAULT_OVER_CURRENT);
        TIM1->BDTR &= ~TIM_BDTR_MOE;     // 软关 PWM
        g_state.fault_pending = 1;
    }
    /* 母线电压窗口 */
    if (g_state.udc > UDC_MAX) save_snapshot(FAULT_OVER_VOLTAGE);
    if (g_state.udc < UDC_MIN) save_snapshot(FAULT_UNDER_VOLTAGE);
    /* 相电流和检测缺相 */
    if (fabsf(g_state.ia + g_state.ib + g_state.ic) > 1.5f)
        save_snapshot(FAULT_PHASE_LOSS);
}

/* === 第三级：主循环（10 ms） === */
void fault_handler_task(void) {
    if (!g_state.fault_pending) return;
    /* 显示故障码、点亮 LED、发 CAN 报警、写 Flash 长期日志 */
    led_blink(g_snap.code);
    can_send_fault_msg(&__noinit_fault_snap);
    flash_log_append(&__noinit_fault_snap);
    /* 解锁条件（PWM 关 + 故障源消失 + 用户复位）*/
}

/* === 工程套路 ===
 * 1. 上电先读 __noinit_fault_snap，CRC 通过 = 上次复位前有故障，回放给用户
 * 2. 黑匣子触发要快，避免现场被破坏
 * 3. 永远不在中断里做 printf / Flash 写 / Delay
 */`,
    quiz: [
      {
        q: '硬件过流保护和软件过流保护的关键区别？',
        options: ['硬件更慢', '硬件直接关 PWM，不依赖 CPU 状态；软件靠中断', '软件更准', '硬件成本高'],
        correct: 1,
        hint: '硬件比较器 → BKIN → 直接关 PWM 输出，CPU 卡死也救得了。软件保护需要中断响应（≥10μs）甚至更长，关键时刻可能来不及。两者必须并存。',
      },
      {
        q: '调试时电机不正向转、反向反而正常，最可能的原因？',
        options: ['Kp 太大', '相序错（接线 swap 了任意两相，或软件 Ib/Ic 颠倒）', '编码器坏', '过流'],
        correct: 1,
        hint: '相序决定旋转磁场方向。两相互换 = 磁场反转 = 电机反转。修复办法：硬件 swap 任意两根线，或软件里把 Ib 和 Ic 的 ADC 通道互换。',
      },
      {
        q: '示波器看到 Ia 一直比 Ib、Ic 高 1.5A 的固定偏移，最可能的原因？',
        options: ['过流', 'Ia 通道 ADC 偏置未校准', '相序错', 'PWM 频率漂移'],
        correct: 1,
        hint: 'ADC 偏置每路独立。开机时电机不通电，理想 Ia=Ib=Ic=0，但 ADC 读数有几十 mV 偏差对应几百 mA。必须做"零电流采样平均"求出 offset，运行时减掉。',
      },
      {
        q: '电流环 Iq 阶跃响应有 50% 超调，但稳态后 Iq 就稳。最可能的修复？',
        options: ['加大 Ki', '减小 Kp 或加大限幅', '增大母线', '换电机'],
        correct: 1,
        hint: 'Kp 过大 → 阶跃瞬间过冲。如果 Kp 不能再减小（影响响应速度），可加大限幅减小积分饱和的释放冲击。Ki 与超调关系小。',
      },
      {
        q: '黑匣子快照 (fault snapshot) 放在哪种内存最合适？',
        options: ['普通 RAM', '链接脚本指定的 .noinit 段（复位不清零的 RAM）', 'Flash', 'EEPROM'],
        correct: 1,
        hint: '复位时普通 RAM 被清零，故障信息就丢了。.noinit 段在复位时不被 startup 代码清，下次开机能读出来。掉电场景再加 EEPROM/Flash 长期备份。',
      },
    ],
  },
  'hfi-sensorless': {
    id: 'hfi-sensorless',
    introBeginner: {
      metaphor: 'HFI 像往黑屋子里**发声呐**——低速时反电动势太小（"光"看不见），就主动注入一个高频信号，听回声里的"凸极差异"判断转子位置。压缩机零启动靠它。',
      coreIdea: '在 d 轴注入高频电压，IPM 电机 Ld < Lq 让响应电流幅值与转子位置相关，解调后能反推角度。整个过程电机几乎不转，就能知道"它现在朝哪儿"。',
      whyCare: [
        '压缩机要求"零启动"——上电就能直接闭环 FOC，不能像 V/f 那样先盲推。',
        'BEMF 观测器在 < 500 rpm 时基本失效；HFI 是这一段唯一可行方案。',
        '只对 IPM 凸极电机有效；表贴式 PMSM 的 Ld ≈ Lq，HFI 失效。所以选压缩机电机时凸极比是硬指标。',
      ],
      firstAction: '右侧把"凸极比 Lq/Ld"从 2.18 拉到 1.05（接近表贴式），看角度估算崩溃；再拉回 2.5+，立刻锁相。',
    },
    learningGoals: ['理解高频注入的物理直觉与凸极信号机制', '掌握注入 → 响应 → 解调 → PLL 流水线', '知道 HFI 的边界：必须 IPM、低速段、有可听噪声'],
    concepts: ['IPM 电机 Ld < Lq 形成磁阻不对称，注入的高频电流响应在 dq 系不一样。', '解调 = 测量信号 × 同相载波 → 直流分量包含 sin(2·Δθ) 误差信息。', 'PLL 用这个误差锁相到 Δθ = 0，得到平滑角度估算。'],
    formulas: [
      { title: '凸极信号增益', expression: 'gain ≈ (Lq − Ld) / (Lq·Ld) · V_h', explanation: '差越大信号越强；表贴式电机 Lq ≈ Ld 时增益接近 0，HFI 失效。' },
      { title: '解调输出', expression: 'demod_lp ∝ sin(2·(θ_true − θ_est))', explanation: '注意是 2 倍角差——HFI 只能提取到 180° 内的信息，需要额外极性判断逻辑。' },
      { title: 'BEMF vs HFI 切换', expression: 'speed < 5%·rated → HFI;  5-10% → 平滑过渡;  > 10% → BEMF / SMO', explanation: '过渡段需要加权混合两套估算结果，避免切换瞬间角度跳变。' },
    ],
    engineeringMeaning: ['HFI 是压缩机零启动的硬性要求。卖家手册里"凸极比"参数就是为它准备的。', '注入频率折中可听噪声（>1kHz 避开 200-1000Hz 敏感段）和 PWM 余量。', '高频注入会增加铁损和电流谐波，所以高速时必须切 BEMF。'],
    stm32Guide: ['注入的高频信号叠加在电流环 PI 输出之后、反 Park 之前。', '解调用 IIR 低通（截止 ~200Hz），CMSIS-DSP 内置滤波器能直接用。', 'HFI ↔ BEMF 切换用滞回比较器避免抖动。'],
    commonMistakes: ['用在表贴式电机上（Lq ≈ Ld 完全没用）。', '注入电压过大造成可听噪声；过小信号被噪声淹没。', '没做极性判别，启动方向随机。'],
    debugMethods: ['临时装编码器对比 HFI 估算角度。', '看解调输出 demod_lp，正常应是平滑直流；有强 2ω_h 纹波 → 解调 LPF 不够低。', '高速运行时观察 HFI 切到 BEMF 的瞬态——切换瞬间不能有 > 10° 角度跳变。'],
    experiments: ['凸极比 2.5 → 1.05，看 HFI 失效。', '注入频率 800Hz → 200Hz（太低，被 PWM 谐波污染）→ 1500Hz。', '加噪声看 PLL 锁相速度变化。'],
    summary: 'HFI 是压缩机低速无感的标配。本质是用主动注入信号克服 BEMF 在低速消失的盲区，但只对 IPM 凸极有效。',
    nextSteps: ['进入启动状态机模块（14），看 HFI 在整个启动流程里如何与 V/f / BEMF 协作。'],
    codeExample: `/* hfi.c — 压缩机低速无感 HFI 控制 */
typedef struct {
    float v_inject;       // 注入电压幅值 V
    float f_inject;       // 注入频率 Hz
    float omega_inject;   // = 2π × f_inject
    float carrier_phase;  // 载波相位累加
    float demod_lp;       // 解调低通输出
    float lpf_alpha;
    /* PLL */
    float pll_kp, pll_ki, pll_int, theta_est, omega_est;
} hfi_ctx_t;

void hfi_init(hfi_ctx_t *h, float v, float f_hz, float pwm_freq) {
    h->v_inject = v;
    h->f_inject = f_hz;
    h->omega_inject = 2.0f * M_PI * f_hz;
    h->lpf_alpha = (2.0f * M_PI * 200.0f / pwm_freq);  // 200Hz LPF
    /* ... */
}

/* 在 FOC 中断里：注入信号 + 解调 + PLL */
void hfi_step(hfi_ctx_t *h, float i_q_meas, float dt,
              float *out_v_d_inject, float *out_theta_est)
{
    /* 1. 累加载波相位 */
    h->carrier_phase += h->omega_inject * dt;
    if (h->carrier_phase > 2.0f * M_PI) h->carrier_phase -= 2.0f * M_PI;
    float carrier = sinf(h->carrier_phase);

    /* 2. 注入电压（叠加到电流环 V_d 输出之后） */
    *out_v_d_inject = h->v_inject * carrier;

    /* 3. 解调：用 i_q_meas 中的高频分量乘载波 → 包含 sin(2Δθ) */
    float product = i_q_meas * carrier;
    h->demod_lp += h->lpf_alpha * (product - h->demod_lp);

    /* 4. PLL 锁相到 sin(2Δθ) = 0 */
    float err = -h->demod_lp;
    h->pll_int += h->pll_ki * err * dt;
    h->omega_est = h->pll_kp * err + h->pll_int;
    h->theta_est += h->omega_est * dt;
    if (h->theta_est > M_PI) h->theta_est -= 2.0f * M_PI;
    if (h->theta_est < -M_PI) h->theta_est += 2.0f * M_PI;

    *out_theta_est = h->theta_est;
}`,
    quiz: [
      {
        q: 'HFI 能用于表贴式 PMSM (Lq ≈ Ld) 吗？',
        options: ['能', '不能 —— 凸极信号增益接近 0', '只能在低速', '硬件改造后能'],
        correct: 1,
        hint: 'HFI 信号机制依赖 (Lq − Ld) / (Lq·Ld) 不为 0；表贴式电机这一项几乎为零，注入再大也无信号。',
      },
      {
        q: '注入频率为什么常选 800-1500 Hz？',
        options: ['硬件限制', '> 1kHz 避开人耳最敏感的 200-1000Hz；PWM 6kHz 时 1.5kHz 还有 4 倍以上余量', '无所谓', '电网频率相关'],
        correct: 1,
        hint: '可听噪声敏感区 200-1000 Hz；同时要远低于 PWM 频率（一般 < 1/4 PWM）才能保证采样不混叠。',
      },
      {
        q: 'HFI 解调输出 sin(2·Δθ) 意味着角度估算只有 180° 周期歧义，怎么解？',
        options: ['不用解', '启动时用一个固定方向（强制对齐 d 轴）来消除', '改用 cos', '换硬件'],
        correct: 1,
        hint: '上电对齐阶段先给 d 轴一个直流让转子停在零位，PLL 从已知方向开始就避免 180° 翻转。',
      },
      {
        q: 'HFI 切到 BEMF 的速度边界一般是？',
        options: ['同步速 1%', '5-10% 同步速', '50% 同步速', '100%'],
        correct: 1,
        hint: '5-10% 同步速时 BEMF 已经能被 SMO 稳定观测，再用 HFI 反而引入额外噪声和损耗，所以切到 BEMF。',
      },
      {
        q: '同样压缩机，凸极比从 2.5 改到 1.5，HFI 锁相效果会怎么变？',
        options: ['没影响', '锁相时间变长，误差变大', '反而更稳', '不收敛'],
        correct: 1,
        hint: '凸极信号增益 ≈ (r-1)/(r+1)。r=2.5 时 0.43；r=1.5 时 0.20，下降一半多，信号变弱噪声相对放大。',
      },
    ],
  },
  'apf-frontend': {
    id: 'apf-frontend',
    introBeginner: {
      metaphor: 'APF / PFC 像家用变频器的"电源整形师"——把"电网取来的杂乱无章电流"整理成跟电压同形同步的干净正弦，顺便升压到 380V 给后级压缩机变频器用。没有它，电流谐波超标过不了认证，电网也用得吃力。',
      coreIdea: '单相 220V 电网经整流桥得到 |sin| 半波，再用 Boost 升压电路 + 双环控制（外环稳母线、内环让电感电流跟踪 |sin|）实现高功率因数 + 低 THD + 稳定 380V 母线。',
      whyCare: [
        '国标 GB/T 17625.1 要求家电谐波；没 PFC 直接整流的 THD > 100%，过不了认证。',
        '380V 高母线是后级 FOC 弱磁运行的前提（详见弱磁模块）。',
        '负载（压缩机）功率突变时 PFC 的电压环要能稳住母线，不让 FOC 看到大电压扰动。',
      ],
      firstAction: '右侧把"母线目标 Udc"从 380V 拉到 250V（接近不升压），看输入电流和电网电压的相位偏差变大、PF 降低；再拉回 380V，PF 接近 1。',
    },
    learningGoals: ['理解 Boost PFC 拓扑和控制目标', '掌握双环结构：电压环 + 电流环', '知道 PF / THD / 母线纹波三个关键指标的工程含义'],
    concepts: ['Boost PFC = 整流桥 + 升压电感 + 开关 + 二极管 + 母线电容；通过控制开关让电感电流跟踪 |sin|。', '外环：母线电压 PI → 输出电流参考幅值。内环：参考 × |sin| 与电感电流比较 → 占空比。', 'PF = 真功率 / 视在功率；THD = 谐波 RMS / 基波 RMS；纹波 % = (Umax-Umin)/Uavg。'],
    formulas: [
      { title: 'Boost 升压关系（稳态）', expression: 'Udc = Vrect / (1 - D)', explanation: 'D 是占空比；D=0 时 Udc=Vpeak（不升压），D=0.5 时 Udc=2·Vpeak。' },
      { title: '理想 PF', expression: 'PF = 1  当 i_line(t) = k · v_line(t)', explanation: '电流和电压完全同相位、同形状（正弦），PF=1。PFC 的目标就是逼近这个状态。' },
      { title: '母线纹波', expression: 'ΔUdc ≈ I_load / (2·ω_line · C)', explanation: '电网频率两倍是主纹波频率（整流桥输出 100Hz）；C 越大纹波越小。' },
    ],
    engineeringMeaning: ['PFC 是直流变频空调和工业冰箱的标配前级，不是"加分项"。', '电流环带宽 1-5 kHz，电压环带宽 50-200 Hz；外环带宽要远小于内环避免互相打架。', '母线电容选型按"持住 ≥ 1 个电网周期能量"算，太小纹波大、太大启动冲击大。'],
    stm32Guide: [
      'PFC 用单独的 PWM 通道（典型 TIM1_CH4 或 TIM3）；和 FOC 隔开避免相互干扰。',
      '电流采样用 OPAMP 内置 + ADC injected 与 PWM 同步；母线 ADC 可放在常规序列。',
      'CCM (连续导通模式) 最常用；轻载 DCM 切换边界要单独处理避免调制比突变。',
    ],
    commonMistakes: ['内外环带宽颠倒（外环比内环快） → 振荡。', '负载突变没限速 → 母线被瞬间拉低。', '电流采样滤波太重 → 内环失稳。', '没区分 100Hz 纹波和 PWM 开关纹波。'],
    debugMethods: ['示波器抓输入电压和电流，理想应同相同形状。', 'FFT 分析输入电流谐波，3/5/7 次是常见超标项。', '观察负载阶跃下母线电压跌落和恢复时间。'],
    experiments: ['Udc 380→250V 看 PF 下降。', '负载电流 4→12A 看母线下沉。', 'Boost 电感 1.5→0.5 mH 看电流纹波加剧。'],
    summary: 'PFC 是压缩机变频器与电网的"接口管理员"——又要听电网话（PF=1），又要给后级稳定母线。双环 + 平均模型是入门的钥匙。',
    nextSteps: ['至此 15 个模块全部完成。回到电机基础（01）按顺序通读，能完整看懂一台压缩机变频器从电网到电机的整条链路。'],
    codeExample: `/* apf_pfc.c — 单相 Boost PFC 双环控制
 * PWM 频率 60kHz，控制周期 = PWM 周期 = 16.7μs
 * 适配 STM32G4 + OPAMP 内置电流放大
 */

typedef struct {
    /* 测量 */
    float v_ac_rect;     // 整流后电压（A/D 实测）
    float i_l;           // 电感电流 A
    float udc;           // 母线电压 V

    /* 给定 */
    float udc_ref;       // 母线目标
    float i_amp_ref;     // 电流幅值参考（电压环输出）

    /* 控制器状态 */
    float volt_int, curr_int;
    float volt_kp, volt_ki;
    float curr_kp, curr_ki;

    /* 内部 */
    float sin_norm;      // |sin(ωt)| 模板（由零交叉过 PLL 得到）
} pfc_ctx_t;

void pfc_pwm_isr(pfc_ctx_t *p, float dt) {
    /* 1. 外环（电压）：每 N 个 PWM 周期跑一次（这里假设每周期都跑） */
    float err_v = p->udc_ref - p->udc;
    p->volt_int += err_v * dt;
    p->i_amp_ref = clamp(p->volt_kp * err_v + p->volt_ki * p->volt_int, 0, 30);

    /* 2. 电流参考：跟踪 |sin| */
    float i_ref = p->i_amp_ref * p->sin_norm;

    /* 3. 内环（电流） */
    float err_i = i_ref - p->i_l;
    p->curr_int += err_i * dt;
    float duty = p->curr_kp * err_i + p->curr_ki * p->curr_int;
    duty = clamp(duty, 0, 0.95f);

    /* 4. 写 CCR */
    TIM1->CCR4 = (uint16_t)(duty * (TIM1->ARR + 1));
}

/* 零交叉检测产生 |sin| 模板：
 * 输入端电压采样 PLL 跟随 100Hz 整流后正弦的相位 */
void pfc_update_sine_template(pfc_ctx_t *p) {
    /* 简化：直接用 v_ac_rect 归一化 */
    static float v_peak = 1;
    if (p->v_ac_rect > v_peak) v_peak = p->v_ac_rect;
    v_peak *= 0.9999f;     // 慢衰减
    p->sin_norm = p->v_ac_rect / fmaxf(v_peak, 1.0f);
}`,
    quiz: [
      {
        q: 'Boost PFC 的双环结构里，谁是外环？',
        options: ['电流环', '电压环', '同等', '看负载'],
        correct: 1,
        hint: '电压环外、电流环内。外环慢（50-200 Hz），内环快（1-5 kHz）。外环输出当作内环参考幅值。',
      },
      {
        q: '理想 PF=1 的输入电流应该长什么样？',
        options: ['方波', '|sin| 半波', '与电网电压同相位的正弦（含正负）', '常数'],
        correct: 2,
        hint: 'PF = 1 ⇔ 电流与电压完全同相同形。注意：电感电流是 |sin|（始终正），但输入端线电流随电网半波翻转，是完整正弦。',
      },
      {
        q: '母线电容 C 增大 4 倍，100Hz 纹波幅度大约怎么变？',
        options: ['不变', '4 倍', '减半', '减 4 倍'],
        correct: 3,
        hint: 'ΔUdc ≈ I/(2ω·C)，反比于 C。C 翻 4 倍 → 纹波 1/4。但启动冲击电流也成比例增大，要折中。',
      },
      {
        q: '不加 PFC 直接用整流桥 + 大电容做"被动 PF"，输入电流大概什么样？',
        options: ['正弦', '只在电网电压峰值附近的窄脉冲，THD > 100%', '方波', '直流'],
        correct: 1,
        hint: '电容电压接近 Vpeak 时整流桥才导通，电流是高瘦窄脉冲，谐波丰富，THD 通常 100-150%。这就是为什么国标不让用。',
      },
      {
        q: '负载（压缩机变频器）从 4A 突变到 12A，PFC 母线电压会怎么样？',
        options: ['立刻稳', '短时下沉，电压环把它拉回目标', '持续下降', '飞升'],
        correct: 1,
        hint: '负载突变让 C 放电速度增加，母线下沉。电压环 PI 检测到 err 增大 → 拉高电流幅值参考 → 内环吸收更多能量补偿 → 母线回到目标。整个过程典型 50-200ms。',
      },
    ],
  },
  'startup-statemachine': {
    id: 'startup-statemachine',
    introBeginner: {
      metaphor: '压缩机启动像飞机起飞——上电（停机检查）→ 母线预充电（滑行）→ 转子对齐（找跑道方向）→ V/f 拖动（推力起跑）→ HFI 接管（收起落架）→ BEMF 闭环（爬升）→ 弱磁（巡航）。每个阶段有进入/退出条件，跳错顺序就翻车。',
      coreIdea: '一台靠谱的压缩机变频器内部就是一个清晰的 7 状态状态机，每个状态做一件事、有进入/退出条件、出错有兜底。',
      whyCare: [
        '"压缩机启动失败"是售后第一大类故障，几乎都是状态机设计问题。',
        '状态机思维能让代码可测、可调、可移植——不用担心每个新机型从头试错。',
        '反液击斜坡是行业经验值（300-800 rpm/s），违反就可能损坏阀片和活塞。',
      ],
      firstAction: '右侧把"加速斜坡"从 600 rpm/s 拉到 3000，模拟违规快速启动；看 Iq 电流瞬间撞高（液击隐患）。再拉回 400，曲线平滑。',
    },
    learningGoals: ['理清压缩机启动 7 个状态及切换条件', '理解反液击斜坡的工程意义', '会读启动失败时的状态机日志'],
    concepts: ['上电后状态机依次推进；每个状态有 entry/exit/timeout。', '状态切换条件常用滞回比较器避免抖动。', '反液击核心是限制 dω/dt，让液态制冷剂被气化前不被快压。'],
    formulas: [
      { title: '反液击斜坡上限', expression: 'dω/dt ≤ ω_ramp_max', explanation: '行业经验：300-800 rpm/s。具体看压缩机厂商手册。' },
      { title: 'V/f 启动电压', expression: 'V_phase = V_min + (V_rated/ω_rated) · ω', explanation: '低速给一个最小电压克服阻性压降，确保电机能动起来。' },
      { title: '阶段切换边界', expression: 'HFI: ω < 5% rated;  BEMF: 5-100% rated;  弱磁: ω > 80% rated', explanation: '边界要带滞回避免在临界点反复切换。' },
    ],
    engineeringMeaning: ['状态机是现场调试的"导航地图"——故障定位先看是哪个状态卡住或异常切换。', '每个状态的 timeout / fault 条件必须显式定义，不能依赖"应该会切过去"。', '弱磁与 BEMF 状态可以共存，弱磁是 BEMF 状态的子集行为。'],
    stm32Guide: ['用 enum + switch 实现，每个 case 处理 entry / steady / exit。', '状态变量、时间戳、上一状态都要记录，便于黑匣子回放。', '从一个状态到另一个状态时，重置控制器积分器（PI 切换）以避免冲击。'],
    commonMistakes: ['没设 timeout，HFI 永远等不到 BEMF 切入。', '加速斜坡过陡 → 液击。', 'V/f 启动电压过大 → 启动电流超限触发硬件保护。'],
    debugMethods: ['启动失败时记录最后状态 + 该状态停留时长 + 上一状态。', '示波器同时抓母线电压、Iq、转速，看哪一拍出问题。', '阶跃测试每个状态的进入/退出，模拟极端值（加大斜坡、最小目标转速等）。'],
    experiments: ['加速斜坡 200 vs 1500 rpm/s，看启动总耗时和 Iq 峰值。', '改 HFI 切入阈值 50 → 200 rpm，看启动序列变化。', '目标转速从 3000 改到 8000，看是否进入弱磁状态。'],
    summary: '压缩机启动 = 7 状态状态机 + 反液击斜坡 + 平滑切换。这是工程化交付的"骨架"。',
    nextSteps: ['第三波模块：APF 前级 + 压缩机故障库（液击 / 堵转 / 缺相 / 母线欠压）。'],
    codeExample: `/* compressor_startup.c — 7 状态启动状态机 */

typedef enum {
    STATE_IDLE,
    STATE_PRECHARGE,
    STATE_ALIGN,
    STATE_OPEN_LOOP,
    STATE_HFI,
    STATE_BEMF,
    STATE_FIELDWEAK,
    STATE_FAULT
} startup_state_t;

typedef struct {
    startup_state_t state;
    uint32_t state_enter_ms;
    float rpm_ref;
    float rpm_actual;
    float accel_ramp_rpm_s;
} startup_ctx_t;

void startup_tick(startup_ctx_t *ctx, float dt) {
    uint32_t age = HAL_GetTick() - ctx->state_enter_ms;

    switch (ctx->state) {
    case STATE_IDLE:
        if (cmd_start_received()) goto_state(ctx, STATE_PRECHARGE);
        break;

    case STATE_PRECHARGE:
        if (g_state.udc > UDC_OK_THRESHOLD && age > 200) {
            goto_state(ctx, STATE_ALIGN);
        }
        if (age > 2000) goto_fault(ctx, FAULT_PRECHARGE_TIMEOUT);
        break;

    case STATE_ALIGN:
        /* 给 d 轴施加直流让转子归零 */
        set_open_loop_voltage(ALIGN_VD, 0, 0);
        if (age > ALIGN_DURATION_MS) {
            ENCODER->CNT = 0;       // 清编码器零位
            goto_state(ctx, STATE_OPEN_LOOP);
        }
        break;

    case STATE_OPEN_LOOP:
        ctx->rpm_ref += ctx->accel_ramp_rpm_s * dt;
        if (ctx->rpm_ref >= HFI_HANDOFF_RPM) {
            goto_state(ctx, STATE_HFI);
        }
        break;

    case STATE_HFI:
        ctx->rpm_ref += ctx->accel_ramp_rpm_s * dt;
        if (ctx->rpm_ref >= BEMF_HANDOFF_RPM && bemf_lock_quality_ok()) {
            goto_state(ctx, STATE_BEMF);
        }
        break;

    case STATE_BEMF:
        ctx->rpm_ref = ramp_to(ctx->rpm_ref, ctx->target_rpm,
                               ctx->accel_ramp_rpm_s * dt);
        if (ctx->rpm_actual > FIELDWEAK_RPM) {
            goto_state(ctx, STATE_FIELDWEAK);
        }
        break;

    case STATE_FIELDWEAK:
        /* 弱磁不是新状态，是 BEMF 上的修饰；这里允许双向切换 */
        if (ctx->rpm_actual < FIELDWEAK_RPM - HYST) {
            goto_state(ctx, STATE_BEMF);
        }
        break;

    case STATE_FAULT:
        disable_pwm();
        break;
    }
}

/* 关键：状态切换时记录黑匣子 + 重置 PI 积分器 */
void goto_state(startup_ctx_t *ctx, startup_state_t next) {
    snapshot_log(ctx->state, next, HAL_GetTick());
    pi_reset(&pi_iq);
    pi_reset(&pi_id);
    ctx->state = next;
    ctx->state_enter_ms = HAL_GetTick();
}`,
    quiz: [
      {
        q: '压缩机启动状态机第一个状态是什么？',
        options: ['对齐', '母线预充电', 'V/f 启动', 'BEMF'],
        correct: 1,
        hint: '上电后母线电容是空的，必须先经过限流电阻缓慢预充电（~200ms）才能切到正常工作母线，否则瞬间冲击电流过大。',
      },
      {
        q: '反液击斜坡 600 rpm/s 是啥意思？',
        options: ['每秒最多升 600 rpm', '每分钟', '每小时', '每毫秒'],
        correct: 0,
        hint: '加速度上限 600 rpm/s 意味着 0→3000 rpm 至少要 5 秒。这是行业经验值，过快会让液态制冷剂被压缩损坏阀片。',
      },
      {
        q: '从 HFI 切到 BEMF 的判据除"转速达到阈值"外还应该有什么？',
        options: ['没有', 'BEMF 信号质量足够（幅值 > 阈值，PLL 已锁定）', '时间到了', '硬件就绪'],
        correct: 1,
        hint: '光看转速不够。要确认 BEMF 信号信噪比足以让 SMO 稳定锁相，否则切过去角度立刻发散。常用滞回比较器避免抖动。',
      },
      {
        q: '状态切换时为什么要重置 PI 积分器？',
        options: ['代码规范', '上一状态积累的积分项与新状态不匹配，会引起切换瞬态超调', '内存优化', '降低延迟'],
        correct: 1,
        hint: 'V/f 阶段没有电流环；进入 HFI/BEMF 闭环时 PI 积分应从 0 开始，否则会有一个错的初始偏置导致瞬态过冲。',
      },
      {
        q: '黑匣子日志最该记录哪些字段？',
        options: ['只记状态', '上一状态、当前状态、停留时长、状态进入瞬间的关键变量（rpm/Iq/Udc/温度）', '只记时间戳', '只记错误码'],
        correct: 1,
        hint: '故障复盘最常用的是"切换瞬间的快照"：能看到从哪儿来、停了多久、走时带的状态如何。仅状态码无法定位问题。',
      },
    ],
  },
  'refrigeration-bench': {
    id: 'refrigeration-bench',
    learningGoals: [
      '把蒸气压缩制冷循环的 4 状态点（吸气-排气-冷凝-节流）搞清楚，会读 P-h 图。',
      '会从工况（蒸发/冷凝温度、过热度、室外温度）反算压力比、容积效率、排气温度。',
      '理解 COP 与电机 Iq 的耦合：循环侧需求决定电机侧 Iq 给定。',
      '能识别"系统侧问题"（缺氟、堵塞）vs"电机侧问题"（控制参数、采样故障）。',
    ],
    engineeringMeaning: [
      '电机调试看似在调电流环，最终决定客户体验的是"该工况下能不能稳态运行 + COP 多少"。',
      '排气温度、吸排气压力是压缩机寿命指标，比电机绕组温度更早预警系统问题。',
      'EEV 控制和 FOC 速度环往往是同一个 MCU 跑的，懂台架才能写好系统状态机。',
      'APF/能效认证看的是系统级 COP 不是电机效率，工况优化空间通常更大。',
    ],
    introBeginner: {
      metaphor: '电机和算法做得再好，最后用户感受到的是"压缩机吹出来的冷风够不够冷、耗电多不多"。这一节把整个制冷系统拉进来——给定室外/室内温度、蒸发/冷凝温度，模拟蒸气压缩循环，看真实的吸排气压力、流量、COP，反过来印证电机需要多大的 Iq。',
      coreIdea: '蒸气压缩制冷四步走：① 压缩机把低压气压缩成高压高温气；② 冷凝器把热放给室外；③ 膨胀阀让高压液降到低压两相；④ 蒸发器从室内吸热回到低压气。压差由 T_e/T_c 决定，压差越大 → 压缩功越大 → 电机 Iq 越大、COP 越低。',
      whyCare: [
        '工况变化时（夏天 vs 冬天 / 高负载 vs 低负载），FOC 的 Iq 给定根本就是工况映射出来的，不是凭空设的。',
        '排气温度是压缩机寿命的命门——超 110℃ 会烧 PVE 油、毁绕组绝缘。',
        '客户投诉"制冷不行"几乎都是循环侧的问题（缺氟/堵塞/冷凝差），先看吸排气压力比看电流更直接。',
        'COP 是节能认证（一级能效 / APF）的核心指标，工况优化空间往往大于电机优化。',
      ],
      firstAction: '调蒸发温度 T_e 从 5℃→12℃，看吸气压力如何变化、COP 怎么涨——这是夏天空调"温和模式"和"强劲模式"的真实切换。',
    },
    concepts: [
      '蒸气压缩循环是逆卡诺循环的工程实现——耗电做功，把低温处的热搬到高温处。',
      '压缩比 = P_d/P_s = 饱和压力比；空调典型 3-5，冷冻可达 8+。',
      '容积效率 η_v = 1 - C·((P_d/P_s)^(1/n) - 1)：余隙气在排气结束后膨胀回吸入冲程，挤占新气进入空间。',
      '排气温度 T_d 由多变压缩 T_d = T_s · (P_d/P_s)^((n-1)/n) 决定；n≈1.18-1.25。',
      '单位制冷量 q_c = h_1 - h_4，单位功 w = h_2 - h_1，COP = q_c/w。',
      '过热度的双面性：过低（<3K）有液击风险，过高（>10K）牺牲制冷量、抬升排气温度。',
    ],
    formulas: [
      { title: '压力-温度对应（Antoine 简化）', expression: 'ln(P_MPa) = A - B/T_K', explanation: 'A、B 是制冷剂常数。本仿真三种制冷剂的 (A, B)：R-32 (8.515, 2382)、R-410A (8.474, 2376)、R-134a (8.505, 2658)。' },
      { title: '多变压缩排气温度', expression: 'T_d = T_s · (P_d/P_s)^((n-1)/n)', explanation: 'n = 多变指数。R-32 取 1.20，R-410A 取 1.18，R-134a 取 1.13。压缩比每翻倍，排气温度涨 ~30%。' },
      { title: '容积效率', expression: 'η_v = 1 - C·((P_d/P_s)^(1/n) - 1)', explanation: 'C 是余隙比，常见 3-8%。压比 5 时容积效率从 95% 跌到 70%。' },
      { title: '质量流量', expression: 'm_dot = ρ_1 · V_disp · η_v · N', explanation: 'ρ_1 是吸气密度（与 T_e 强相关），V_disp 是排量 (m³)，N 是转速 (rps)。' },
      { title: 'COP 与电流耦合', expression: 'τ = W_comp/ω, Iq = τ / (1.5·Pp·ψ_f)', explanation: '系统侧算出 W_comp → 机械扭矩 τ，反推 FOC 需要的 Iq。这是闭环耦合的桥梁。' },
    ],
    stm32Guide: [
      'EEV 控制：常见用 PG/Beck/Sanhua 的步进式电子膨胀阀，通过 GPIO 串行驱动，开度对应步数（0-500 步）。',
      '过热度反馈：吸气管贴 NTC，对照饱和压力得到 SH = T_suct - T_sat(P_s)。EEV PI 控制目标常设 SH=5K。',
      '排气保护：T_d > 105℃ 即降频，> 115℃ 直接停机。NTC 用 100kΩ B3950，ADC 通道独立。',
      '高低压保护：吸气压力传感器 (0.5-4.5V → 0-2.5MPa)、排气压力传感器 (0.5-4.5V → 0-5MPa)，触发硬件比较器直停 PWM。',
      '室外温度：贴在冷凝器进风侧，作为变频降频和 EEV 前馈的输入。',
      '工况-频率映射：T_outdoor、T_indoor、目标 ΔT 三维插值表 → 目标转速；典型表：5kHz × 3kHz × 5kHz=75 个工作点。',
    ],
    commonMistakes: [
      '凭电流大小判断工况，忽略 EEV 是否开够。EEV 卡死小开度时 Iq 会偏大但其实是循环堵塞。',
      'EEV 反馈环用蒸发出口温度而不是过热度。一旦 P_s 漂了，温度就没意义。',
      '冷凝风机停转后还在催高频，结果 P_d 飙升触发高压保护。需要先降频再停机。',
      '工况-频率表只标定常温，极端高温（>40℃）和低温（<-5℃）外推会爆。',
    ],
    debugMethods: [
      '手测：吸气压力 + 吸气温度 → 算 SH；排气压力 + 排气温度 → 算 SC（实际系统是 P_d 上的过冷度）。',
      '快充快放观察：稳态后切大负载，看 P_d 多久稳住，电机 Iq 是否能跟上——这是 EEV/PFC/FOC 速度环带宽的综合体现。',
      '冷媒泄漏诊断：相同工况下 m_dot 变小、SH 变大、COP 下降 → 缺氟。',
      '冷凝堵塞诊断：相同工况下 P_d 升高、T_d 升高、COP 下降 → 冷凝器脏堵或风机失速。',
    ],
    experiments: [
      '对比 R-32 vs R-410A：同样 T_e/T_c 下，R-32 流量小 1/3 但 COP 高 5-8%。',
      '提升过热度从 5K 到 12K：制冷量降 8%，排气温度升 8℃。看哪个先到红线。',
      '室外温度从 35℃ 升到 45℃：T_c 跟着升 → 压比涨 → η_v 跌 → 流量小 + 单位功大 → COP 从 3.5 跌到 2.2。',
      '开启闭环耦合后改变 T_c，回到 06 号 FOC 模块看 iqRef 是否同步变化。',
    ],
    summary: '制冷台架是电机控制工程师最常忽略也最容易被反咬的领域：电机做得多稳都救不了循环本身。掌握 P-h 图 + COP 推导，能让你和系统工程师同频沟通，也能在客户投诉面前一眼看出问题在系统侧还是电机侧。',
    nextSteps: [
      '回到 06 号 FOC 总流程模块，关闭闭环切到手动 Iq，对照本台架算出的负载需求观察电机响应。',
      '再去 09 号三闭环模块，测试速度环对工况突变的抗扰能力。',
      '到 12 号故障与调试模块复盘"液击/堵转"等本节衍生的故障形态。',
    ],
    codeExample: `/* ============================================
 * 工况采集 + 压缩机变频器主循环（简化）
 * ============================================ */

typedef struct {
    float Te_C, Tc_C;          /* 由饱和压力反算 */
    float Ps_MPa, Pd_MPa;      /* 直读传感器 */
    float Tsuct_C, Tdisch_C;   /* NTC */
    float SH_K, SC_K;          /* 派生 */
    float T_outdoor_C, T_indoor_C;
    uint16_t eev_steps;        /* 0..500 */
} bench_state_t;

/* 1kHz 慢任务：工况采集与保护 */
void bench_slow_task(bench_state_t *s) {
    s->Ps_MPa = adc_to_pressure(adc_low_side_channel);
    s->Pd_MPa = adc_to_pressure(adc_high_side_channel);
    s->Tsuct_C = ntc_to_temp(adc_suction_channel);
    s->Tdisch_C = ntc_to_temp(adc_discharge_channel);

    /* 反查饱和温度（查表 / Antoine 反推） */
    s->Te_C = sat_temp_from_p(s->Ps_MPa, REFRIGERANT);
    s->Tc_C = sat_temp_from_p(s->Pd_MPa, REFRIGERANT);
    s->SH_K = s->Tsuct_C - s->Te_C;
    s->SC_K = s->Tc_C - ntc_to_temp(adc_subcool_channel);

    /* 排气温度保护 */
    if (s->Tdisch_C > 115.0f) {
        emergency_stop("DISCHARGE_OVERTEMP");
    } else if (s->Tdisch_C > 105.0f) {
        derate_rpm_target(0.85f);
    }

    /* 高压保护 */
    if (s->Pd_MPa > pd_threshold_for_outdoor(s->T_outdoor_C)) {
        derate_rpm_target(0.7f);
    }
}

/* 100Hz EEV PI 控制：过热度跟踪 */
void eev_pi_task(bench_state_t *s) {
    static float integ = 0;
    const float SH_TARGET = 5.0f;       /* 5K 过热度 */
    float err = SH_TARGET - s->SH_K;
    integ += err * 0.01f;
    integ = clampf(integ, -50, 50);
    int16_t delta_steps = (int16_t)(2.0f * err + 5.0f * integ);

    /* SH 偏低（过湿）→ 关 EEV；SH 偏高（过干）→ 开 EEV */
    s->eev_steps = clamp_u16(s->eev_steps - delta_steps, 0, 500);
    eev_drive_steps(s->eev_steps);
}

/* 工况→频率映射（三维查表） */
uint16_t lookup_target_rpm(float T_outdoor, float T_indoor, float deltaT_target) {
    /* table[T_out][T_in][dT] → rpm */
    return rpm_lookup_3d(T_outdoor, T_indoor, deltaT_target);
}

/* 主循环 */
void main_loop(void) {
    bench_state_t bench = {0};
    while (1) {
        if (slow_tick_1khz()) bench_slow_task(&bench);
        if (slow_tick_100hz()) eev_pi_task(&bench);
        uint16_t target_rpm = lookup_target_rpm(
            bench.T_outdoor_C, bench.T_indoor_C, get_user_setpoint() - bench.T_indoor_C);
        speed_loop_set_target(target_rpm);
        /* FOC 快环（10kHz）独立由 ADC 中断驱动，不在这里 */
    }
}
`,
    quiz: [
      {
        q: '室外 35℃→45℃ 时 COP 主要因为什么下降？',
        options: ['压缩比变大同时容积效率下降', '冷媒比热变化', '电机效率变化', '室内温度变化'],
        correct: 0,
        hint: 'T_c 升高 → P_d 升高 → 压比变大 → 多变压缩耗功增加 + 容积效率(η_v)下降，单位流量做的有用功更少。',
      },
      {
        q: '排气温度逼近 110℃ 通常表明：',
        options: ['冷媒充注过多', '过热度过低且压比过大', '冷凝压力偏低', '电机绕组温度偏高'],
        correct: 1,
        hint: '排气温度 = 吸气温度 ×(压比^((n-1)/n))。SH 太高（吸气温度高）+ 高压比是双重原因。',
      },
      {
        q: '电子膨胀阀 EEV 通常用什么作为反馈量？',
        options: ['排气温度', '冷凝压力', '吸气过热度 SH', '吸气压力'],
        correct: 2,
        hint: 'EEV 的核心目标是让蒸发器出口处于"刚刚气化干净 + 一点过热"，即 SH 控在 3-7K。',
      },
      {
        q: '工况突然加重（T_c 升高）时，FOC 模块的 Iq 给定应该如何变化？',
        options: ['不变，电机自动适应', '降低 Iq', '升高 Iq', '反向 Iq'],
        correct: 2,
        hint: 'T_c 升 → 压缩功 W_comp 升 → 机械扭矩升 → FOC 速度环为了维持转速必须增大 Iq。这就是闭环耦合。',
      },
      {
        q: 'COP=3.5 的物理含义是？',
        options: ['1 kW 电搬走 3.5 kW 的热', '电机效率 350%', '冷媒流量是电流的 3.5 倍', '蒸发温度是冷凝温度的 3.5 分之一'],
        correct: 0,
        hint: 'COP = Q_c / W_input。注意它是"性能系数"不是"效率"——可以大于 1，因为能量来源还包括从环境吸收的热。',
      },
    ],
  },
};

const fallbackLesson: LessonContent = {
  id: 'motor-basics',
  learningGoals: [],
  concepts: [],
  formulas: [],
  engineeringMeaning: [],
  stm32Guide: [],
  commonMistakes: [],
  debugMethods: [],
  experiments: [],
  summary: '本模块自带专属 UI / 教学引导，未提供通用讲义。',
  nextSteps: [],
  codeExample: '',
};

/**
 * Resolve which language source (if any) has an entry for the requested module.
 *
 * Returns:
 *  - 'en-US' when the active locale is English and a real English entry exists.
 *  - 'zh-CN' when a Chinese entry exists (default / fallback).
 *  - null when neither side has content (very rare; only for placeholder modules).
 */
export function getFallbackLanguage(id: ModuleId, locale: Locale): 'zh-CN' | 'en-US' | null {
  if (locale === 'en-US' && lessonsEn[id]) return 'en-US';
  if (lessons[id]) return 'zh-CN';
  if (lessonsEn[id]) return 'en-US';
  return null;
}

/**
 * Look up a lesson by id, honouring the active i18n locale.
 *
 * Behaviour:
 *  - When locale is 'en-US' and `lessonsEn` has the entry, return the English version.
 *  - Otherwise fall back to the Chinese version in `lessons`.
 *  - When neither side has the entry, return the empty fallback (legacy behaviour).
 */
export function getLesson(id: ModuleId, localeOverride?: Locale): LessonContent {
  const locale = localeOverride ?? useI18nStore.getState().locale;
  if (locale === 'en-US') {
    const en = lessonsEn[id];
    if (en) return en;
  }
  return lessons[id] ?? lessonsEn[id] ?? fallbackLesson;
}
