// 生成剩余 8 题的扫描参考数据（官方答案经解释器逐点求值 → 冻结）。
// 输出 JSON 到 stdout；人工核对后并入 src/content/codelab/sweeps.ts。
// Run:
//   npx esbuild --bundle scripts/gen-sweeps2.mjs --outfile=tmp/gen2.out.mjs --format=esm --platform=node
//   node tmp/gen2.out.mjs
import { codeChallenges } from '../src/content/codelab/index';
import { codeLabSolutions } from '../src/content/codelab/solutions';
import { runSweep } from '../src/simulation/codelab/runner';

/** 各题扫描定义（argIndex/from/to/fixedArgs/xLabel/outLabels）。 */
const defs = {
  'pi-step': {
    argIndex: 0, from: -5, to: 5, points: 48,
    fixedArgs: [0, 2, 500, 0],
    xLabel: 'err (A)', outLabels: ['out', 'int'],
  },
  'svpwm-core': {
    argIndex: 0, from: -100, to: 100, points: 48,
    fixedArgs: [0, 0, 310],
    xLabel: 'Vα (V)', outLabels: ['sector', 't1', 't2'],
  },
  'lpf-step': {
    argIndex: 2, from: 0, to: 1, points: 48,
    fixedArgs: [1, 0],
    xLabel: 'α', outLabels: ['y'],
  },
  'notch-coeff': {
    argIndex: 0, from: 100, to: 2000, points: 48,
    fixedArgs: [0, 10000, 8],
    xLabel: 'f0 (Hz)', outLabels: ['b0', 'b1', 'b2', 'a1', 'a2'],
  },
  'saliency-ratio': {
    argIndex: 1, from: 2, to: 8, points: 48,
    fixedArgs: [2],
    xLabel: 'Lq (mH)', outLabels: ['ρ'],
  },
  'current-unbalance': {
    argIndex: 1, from: -2, to: 2, points: 48,
    fixedArgs: [2, 0, 1],
    xLabel: 'ib (A)', outLabels: ['pct'],
  },
  'current-thd': {
    argIndex: 1, from: 0, to: 40, points: 48,
    fixedArgs: [100, 0, 8, 4],
    xLabel: 'h3 (%)', outLabels: ['pct'],
  },
  'cop-eer': {
    argIndex: 0, from: 0, to: 10, points: 48,
    fixedArgs: [0, 2.5],
    xLabel: 'Qc (kW)', outLabels: ['COP', 'EER'],
  },
};

const f4 = (v) => Number(v.toFixed(4));

for (const [id, def] of Object.entries(defs)) {
  const challenge = codeChallenges.find((c) => c.id === id);
  if (!challenge) { console.error('unknown challenge', id); process.exit(1); }
  const sol = codeLabSolutions[id];
  const points = def.points ?? 48;
  const sweep = {
    argIndex: def.argIndex, from: def.from, to: def.to, points,
    fixedArgs: def.fixedArgs,
    reference: [],
    xLabel: def.xLabel, outLabels: def.outLabels,
  };
  const r = runSweep(challenge, sol, sweep);
  if (!r.ok) { console.error(`${id} sweep failed: ${r.error}`); process.exit(1); }
  sweep.reference = r.curve.map((row) => row.map(f4));
  console.error(`${id}: ${sweep.reference.length} pts, sample=[${sweep.reference[0]}, ${sweep.reference[sweep.reference.length - 1]}]`);
  console.log(`  '${id}': {
    argIndex: ${def.argIndex}, from: ${def.from}, to: ${def.to}, points: ${points},
    fixedArgs: [${def.fixedArgs.join(',')}],
    reference: [${sweep.reference.map((row) => `[${row.join(',')}]`).join(',')}],
    xLabel: '${def.xLabel}', outLabels: [${def.outLabels.map((l) => `'${l}'`).join(',')}],
  },`);
}
