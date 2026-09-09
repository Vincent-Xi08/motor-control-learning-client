/**
 * 编程实验室判题引擎（纯函数、无 eval / new Function / vm）。
 *
 * 学员代码由 src/simulation/codelab/interpreter.ts 的教学子集解释器
 * 执行：确定性、可中断（步数预算）、零注入面。期望值来自内容文件里
 * 由参考实现冻结的测试向量。
 */

import type { CodeChallenge, CodeLabCase, CodeLabSweep } from '../../content/codelab/types';
import { compileUserProgram } from './interpreter';

export interface CaseResult {
  label: string;
  pass: boolean;
  expected: number[];
  actual: number[];
  /** 失败原因：'error'（异常/非法返回）| 'mismatch' | 'nonfinite' */
  reason: 'ok' | 'error' | 'mismatch' | 'nonfinite';
  message?: string;
}

export interface RunResult {
  ok: boolean;
  /** 通过数 / 总数 */
  passed: number;
  total: number;
  results: CaseResult[];
  /** 编译/执行阶段的致命错误（语法错 / 步数超限 / 找不到函数） */
  fatalError?: string;
}

/** 每个用例的解释器步数预算（防死循环；算法题正常实现远低于此）。 */
export const STEP_BUDGET = 200_000;

function friendlyError(msg: string, functionName: string): string {
  if (msg === 'STEP_BUDGET_EXCEEDED') return '执行步数超限：检查是否存在死循环（本解释器不支持 for/while）';
  if (msg.startsWith('MISSING_FUNCTION:')) return `未找到函数 ${functionName}：请在代码中声明它`;
  return msg;
}

/**
 * 运行一道题（同步、纯函数）。
 * userCode 需声明 functionName 函数（`function name(a, b) { ... }`，
 * 末尾的 `return name;` 可有可无——入口由 functionName 直接定位）。
 */
export function runChallenge(challenge: CodeChallenge, userCode: string): RunResult {
  let program: ReturnType<typeof compileUserProgram>;
  try {
    program = compileUserProgram(userCode);
  } catch (err) {
    return {
      ok: false, passed: 0, total: challenge.cases.length, results: [],
      fatalError: err instanceof Error ? err.message : String(err),
    };
  }

  const results: CaseResult[] = challenge.cases.map((c: CodeLabCase) => {
    const r = program.call(challenge.functionName, c.args, STEP_BUDGET);
    if (!r.ok) {
      return {
        label: c.label, pass: false, expected: c.expected, actual: [],
        reason: 'error', message: friendlyError(r.error, challenge.functionName),
      };
    }
    const raw = r.value;
    const actual = typeof raw === 'number' ? [raw] : Array.isArray(raw) && raw.every((v) => typeof v === 'number') ? raw : null;
    if (actual === null) {
      return {
        label: c.label, pass: false, expected: c.expected, actual: [],
        reason: 'error', message: `返回值应为数字或数字数组，得到 ${Array.isArray(raw) ? '含非数字的数组' : typeof raw}`,
      };
    }
    if (actual.length !== c.expected.length) {
      return {
        label: c.label, pass: false, expected: c.expected, actual,
        reason: 'mismatch', message: `返回长度 ${actual.length} ≠ 期望 ${c.expected.length}`,
      };
    }
    if (actual.some((v) => !Number.isFinite(v))) {
      return { label: c.label, pass: false, expected: c.expected, actual, reason: 'nonfinite' };
    }
    const tol = c.tol ?? 1e-4;
    const pass = actual.every((v, i) => Math.abs(v - c.expected[i]) <= tol);
    return { label: c.label, pass, expected: c.expected, actual, reason: pass ? 'ok' : 'mismatch' };
  });

  const passed = results.filter((x) => x.pass).length;
  return { ok: passed === results.length, passed, total: results.length, results };
}

export interface SweepResult {
  ok: boolean;
  /** 每个采样点的学员函数输出（外层 = 采样点） */
  curve: number[][];
  error?: string;
}

/**
 * 输入扫描：编译一次学员代码，在 sweep 定义的采样点上逐点求值。
 * 用于通关后的"你的曲线 vs 参考曲线"可视化（不判分——判分仍由
 * runChallenge 的冻结用例负责；此处个别点异常只截断曲线并给出提示）。
 */
export function runSweep(challenge: CodeChallenge, userCode: string, sweep: CodeLabSweep): SweepResult {
  const points = sweep.points ?? 60;
  const n = Math.max(2, points);
  let program: ReturnType<typeof compileUserProgram>;
  try {
    program = compileUserProgram(userCode);
  } catch (err) {
    return { ok: false, curve: [], error: err instanceof Error ? err.message : String(err) };
  }
  const curve: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const x = sweep.from + ((sweep.to - sweep.from) * i) / (n - 1);
    const args = [...sweep.fixedArgs];
    args[sweep.argIndex] = x;
    const r = program.call(challenge.functionName, args, STEP_BUDGET);
    if (!r.ok) return { ok: false, curve, error: `x=${x.toFixed(3)} 处出错：${r.error}` };
    const v = r.value;
    const row = typeof v === 'number' ? [v] : Array.isArray(v) && v.every((q) => typeof q === 'number') ? v : null;
    if (row === null || row.some((q) => !Number.isFinite(q))) {
      return { ok: false, curve, error: `x=${x.toFixed(3)} 处返回非有限数值` };
    }
    curve.push(row);
  }
  return { ok: true, curve };
}
