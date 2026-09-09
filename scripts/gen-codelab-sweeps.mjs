// 生成 Code Lab 扫描可视化冻结数据 → 输出 sweeps.ts 源码到 stdout。
// Run:
//   npx esbuild --bundle scripts/gen-codelab-sweeps.mjs --outfile=tmp/gen.out.mjs --format=esm --platform=node
//   node tmp/gen.out.mjs > src/content/codelab/sweeps.ts
// 改完必须跑 vitest src/content/codelab（官方答案曲线与 reference 逐点一致守护）。
import {
  clarkeTransform,
  parkTransform,
  inverseParkTransform,
  generateThreePhaseCurrent,
} from '../src/simulation/math/transforms';

const N = 48;
const f4 = (v) => Number(v.toFixed(4));
const xs = (from, to) => Array.from({ length: N }, (_, i) => from + ((to - from) * i) / (N - 1));

const sweeps = {};

// park：θ 扫 0..2π，(iα,iβ)=(3,1.5)
{
  const ref = xs(0, 2 * Math.PI).map((th) => {
    const { d, q } = parkTransform({ alpha: 3, beta: 1.5 }, th);
    return [f4(d), f4(q)];
  });
  sweeps['park-transform'] = { argIndex: 2, from: 0, to: 6.2832, fixedArgs: [3, 1.5, 0], reference: ref, xLabel: 'θ (rad)', outLabels: ['d', 'q'] };
}
// inversePark：θ 扫 0..2π，(vd,vq)=(2,1)
{
  const ref = xs(0, 2 * Math.PI).map((th) => {
    const r = inverseParkTransform({ d: 2, q: 1 }, th);
    return [f4(r.alpha), f4(r.beta)];
  });
  sweeps['inverse-park-transform'] = { argIndex: 2, from: 0, to: 6.2832, fixedArgs: [2, 1, 0], reference: ref, xLabel: 'θ (rad)', outLabels: ['vα', 'vβ'] };
}
// threePhaseGen：θ 扫 0..2π，幅值 5
{
  const ref = xs(0, 2 * Math.PI).map((th) => {
    const s = generateThreePhaseCurrent({
      amplitude: 5, frequency: 1, phaseDeg: 0,
      time: th / (2 * Math.PI), balance: 0, harmonic: 0, noise: 0,
    });
    return [f4(s.ia), f4(s.ib), f4(s.ic)];
  });
  sweeps['three-phase-gen'] = { argIndex: 1, from: 0, to: 6.2832, fixedArgs: [5, 0], reference: ref, xLabel: 'θ (rad)', outLabels: ['ia', 'ib', 'ic'] };
}
// clarke：ib 扫 −3..3，(ia,ic)=(2,0.5)
{
  const ref = xs(-3, 3).map((ib) => {
    const r = clarkeTransform({ ia: 2, ib, ic: 0.5 });
    return [f4(r.alpha), f4(r.beta), f4(r.zero)];
  });
  sweeps['clarke-transform'] = { argIndex: 1, from: -3, to: 3, fixedArgs: [2, 0, 0.5], reference: ref, xLabel: 'ib (A)', outLabels: ['α', 'β', '0'] };
}
// elecAngle：机械角扫 0..2π，p=4（题面公式 mod = raw − floor(raw/2π)·2π）
{
  const ref = xs(0, 2 * Math.PI).map((m) => {
    const raw = 4 * m;
    const elec = raw - Math.floor(raw / (2 * Math.PI)) * (2 * Math.PI);
    return [f4(elec)];
  });
  sweeps['elec-angle'] = { argIndex: 0, from: 0, to: 6.2832, fixedArgs: [0, 4], reference: ref, xLabel: 'θm (rad)', outLabels: ['θe'] };
}
// vfRamp：f 扫 0..75，fRated=50 vRated=310（clamp + 负频归零）
{
  const ref = xs(0, 75).map((fRaw) => {
    const f = Math.max(0, Math.min(fRaw, 50));
    return [f4(310 * (f / 50))];
  });
  sweeps['vf-ramp'] = { argIndex: 0, from: 0, to: 75, fixedArgs: [0, 50, 310], reference: ref, xLabel: 'f (Hz)', outLabels: ['V'] };
}
// mtpaId：iq 扫 0..150，ψf=0.05 ld=1 lq=3（题面闭式）
{
  const ref = xs(0, 150).map((iq) => {
    const dL = (3 - 1) / 1000;
    return [f4((0.05 - Math.sqrt(0.05 * 0.05 + 8 * dL * dL * iq * iq)) / (4 * dL))];
  });
  sweeps['mtpa-id'] = { argIndex: 0, from: 0, to: 150, fixedArgs: [0, 0.05, 1, 3], reference: ref, xLabel: 'iq (A)', outLabels: ['id*'] };
}
// deadtimeVolt：i 扫 −8..8，vdc=310 dt=1.5e-6 fsw=10k（题面 sign·幅值）
{
  const ref = xs(-8, 8).map((i) => {
    const mag = 310 * 1.5e-6 * 10000;
    const s = i > 0 ? 1 : i < 0 ? -1 : 0;
    return [f4(s * mag)];
  });
  sweeps['deadtime-volt'] = { argIndex: 0, from: -8, to: 8, fixedArgs: [0, 1.5e-6, 10000, 310], reference: ref, xLabel: 'i (A)', outLabels: ['ΔV'] };
}

const body = Object.entries(sweeps)
  .map(([id, s]) => {
    const refStr = s.reference.map((r) => `[${r.join(',')}]`).join(',');
    return `  '${id}': {
    argIndex: ${s.argIndex}, from: ${s.from}, to: ${s.to}, points: ${N},
    fixedArgs: [${s.fixedArgs.join(',')}],
    reference: [${refStr}],
    xLabel: '${s.xLabel}', outLabels: [${s.outLabels.map((l) => `'${l}'`).join(',')}],
  },`;
  })
  .join('\n');

console.log(`import type { CodeLabSweep } from './types';

/**
 * Code Lab 扫描可视化冻结数据（由参考实现 48 点采样生成，勿手改；
 * 再生成：node tmp/gen-sweeps.mjs > src/content/codelab/sweeps.ts）。
 * codelab.test.ts 保证官方答案曲线与 reference 逐点一致。
 */
export const codeLabSweeps: Record<string, CodeLabSweep> = {
${body}
};
`);
