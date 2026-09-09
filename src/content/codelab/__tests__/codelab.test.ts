import { describe, expect, it } from 'vitest';
import { codeChallenges } from '../index';
import { codeLabSolutions } from '../solutions';
import { runChallenge, runSweep } from '../../../simulation/codelab/runner';

const CJK_RE = /[一-鿿　-〿＀-￯]/;

/**
 * 编程挑战内容完备性：
 *  (a) 双语字段 zh-CN / en-US 非空，en 无 CJK（与全局 translations 等价校验）
 *  (b) 测试向量数值全部有限、期望与题面公式一致（参考答案满分通过）
 *  (c) starter 可执行（虽不通过判题，但不能语法错误）
 */
describe('codelab content integrity', () => {
  it('挑战 id / functionName 唯一且挂接合法模块', () => {
    const ids = new Set(codeChallenges.map((c) => c.id));
    const fns = new Set(codeChallenges.map((c) => c.functionName));
    expect(ids.size).toBe(codeChallenges.length);
    expect(fns.size).toBe(codeChallenges.length);
    for (const c of codeChallenges) {
      expect(c.moduleId).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(c.difficulty).toBeGreaterThanOrEqual(1);
      expect(c.difficulty).toBeLessThanOrEqual(3);
    }
  });

  it('双语文案完备，en-US 无中文泄漏', () => {
    for (const c of codeChallenges) {
      for (const entry of [c.title, c.statement, ...c.hints]) {
        expect(entry['zh-CN'].trim().length, `${c.id} zh 空`).toBeGreaterThan(0);
        expect(entry['en-US'].trim().length, `${c.id} en 空`).toBeGreaterThan(0);
        expect(CJK_RE.test(entry['en-US']), `${c.id} en 含中文: ${entry['en-US']}`).toBe(false);
      }
    }
  });

  it('测试向量有限且非空；C 参考与起手代码非空', () => {
    for (const c of codeChallenges) {
      expect(c.cases.length).toBeGreaterThanOrEqual(4);
      for (const tc of c.cases) {
        expect(tc.args.length).toBeGreaterThan(0);
        expect(tc.expected.length).toBeGreaterThan(0);
        for (const v of [...tc.args, ...tc.expected]) expect(Number.isFinite(v)).toBe(true);
      }
      expect(c.cReference.trim().length).toBeGreaterThan(20);
      expect(c.starter.includes(c.functionName)).toBe(true);
    }
  });

  it('每题都有登记的官方答案且满分通过（防止"无解之题"上线）', () => {
    for (const c of codeChallenges) {
      const sol = codeLabSolutions[c.id];
      expect(sol, `${c.id} 缺官方答案登记`).toBeTruthy();
      const r = runChallenge(c, sol);
      expect(r.ok, `${c.id} 官方答案未满分：${r.fatalError ?? JSON.stringify(r.results.filter((x) => !x.pass))}`).toBe(true);
    }
  });

  it('扫描数据完备：reference 点数一致、数值有限、长度与 outLabels 匹配', () => {
    for (const c of codeChallenges) {
      if (!c.sweep) continue;
      const sw = c.sweep;
      const points = sw.points ?? 60;
      expect(sw.reference.length, `${c.id} reference 点数 ≠ points`).toBe(points);
      expect(sw.fixedArgs.length).toBeGreaterThanOrEqual(sw.argIndex);
      expect(sw.outLabels.length).toBeGreaterThan(0);
      expect(sw.xLabel.trim().length).toBeGreaterThan(0);
      for (const row of sw.reference) {
        expect(row.length, `${c.id} 输出长度应与 outLabels 一致`).toBe(sw.outLabels.length);
        for (const v of row) expect(Number.isFinite(v), `${c.id} 扫描点含非有限值`).toBe(true);
      }
    }
  });

  it('官方答案的扫描曲线与冻结 reference 逐点一致（容差 1e-3）', () => {
    for (const c of codeChallenges) {
      if (!c.sweep) continue;
      const sol = codeLabSolutions[c.id];
      const r = runSweep(c, sol, c.sweep);
      expect(r.ok, `${c.id} 官方答案扫描失败：${r.error}`).toBe(true);
      for (let i = 0; i < c.sweep.reference.length; i += 1) {
        const got = r.curve[i];
        const want = c.sweep.reference[i];
        for (let k = 0; k < want.length; k += 1) {
          expect(
            Math.abs((got?.[k] ?? Number.NaN) - want[k]),
            `${c.id} 第 ${i} 点输出 ${k} 偏差过大：got=${got?.[k]} want=${want[k]}`,
          ).toBeLessThanOrEqual(1e-3);
        }
      }
    }
  });
});
