/**
 * 编程实验室（Code Lab）内容 schema。
 *
 * 每道题 = 一个纯函数实现任务：题面（中英）+ 起手代码 + 冻结的测试向量
 * （期望值由 src/simulation/math 参考实现一次性生成后写死为字面量，
 * 运行期零依赖）+ 分级提示 + STM32 C 参考实现（全部通过后解锁展示）。
 *
 * 双语文案直接内嵌为 TranslationEntry（不进全局 translations 表），
 * 由 codelab.test.ts 做等价校验：en 无 CJK / zh,en 非空。
 */

import type { TranslationEntry } from '../../i18n/types';
import type { ModuleId } from '../../simulation/engine/types';

/** 单个测试用例。args 传给学员函数；expected 与返回值逐元素按容差比对。 */
export interface CodeLabCase {
  /** 展示用的输入标签（如 "Ia=1, Ib=-0.5, Ic=-0.5"），中英由外层 entry 处理或纯符号 */
  label: string;
  args: number[];
  /** 期望返回（学员函数应返回数组或单值；单值会包装成 [v]） */
  expected: number[];
  /** 逐元素绝对容差；默认 1e-4 */
  tol?: number;
}

export interface CodeChallenge {
  id: string;
  moduleId: ModuleId;
  /** 学员要实现的函数名（起手代码里的 TODO 函数） */
  functionName: string;
  /** 题面（中英） */
  title: TranslationEntry;
  statement: TranslationEntry;
  /** 起手代码（含函数签名与 TODO 注释） */
  starter: string;
  /**
   * 起手代码英文版（注释译英文，代码骨架与 starter 完全一致）。
   * en-US 下编辑器初始值 / 重置按钮用它；缺省回退 starter。
   */
  starterEn?: string;
  cases: CodeLabCase[];
  /** 分级提示（中英），按序解锁 */
  hints: TranslationEntry[];
  /** STM32 C 参考实现（全部通过后展示；也可提前"偷看"并标记） */
  cReference: string;
  /** 难度 1-3 */
  difficulty: 1 | 2 | 3;
  /**
   * 输入扫描可视化（可选）：通关后把学员函数在扫描区间上逐点运行，
   * 与冻结的参考曲线叠画——"数字对了"升级为"曲线对了"。
   */
  sweep?: CodeLabSweep;
}

/** 扫描定义：x 从 from 到 to 均匀取 points 个点，其余参数固定。 */
export interface CodeLabSweep {
  /** 扫描变量在第几个参数位（0 起） */
  argIndex: number;
  from: number;
  to: number;
  /** 采样点数（含端点），默认 60 */
  points?: number;
  /** 固定的其余参数（长度 = 函数签名参数数，扫描位会被覆盖） */
  fixedArgs: number[];
  /** 参考曲线：每个采样点的期望返回（数组的数组的数组，外层 = 采样点） */
  reference: number[][];
  /** x 轴标签（如 "θ (rad)"），纯符号不翻 */
  xLabel: string;
  /** 输出序列名（与函数返回数组对应，如 ["α", "β", "0"]） */
  outLabels: string[];
}

/** 由内容目录聚合（codelab/index.ts 导出 challenges 数组）。 */
export type CodeChallengeSet = CodeChallenge[];
