# Performance Audit · R2

第二轮性能 / bundle 审计与落地。第一轮（docs/PERFORMANCE_AUDIT.md）做了模块级 lazy split + lessons 按需加载；本轮聚焦 **首屏关键路径裁剪 + 大 chunk 进一步拆分 + 静态资源审计**。

## 一、基线（优化前）

build 产物（`dist/assets/`，gzip 由 `scripts/analyze-bundle.mjs` 实测）。

| Rank | Chunk                        | Raw       | Gzip      |
|------|------------------------------|-----------|-----------|
| 1    | three (R3F + drei + three)   | 1,077 KB  | 302 KB    |
| 2    | charts (recharts 全套)       | 425 KB    | 121 KB    |
| 3    | AssemblyWorkshopModule       | 150 KB    | 47 KB     |
| 4    | index (首屏入口)             | 140 KB    | 48 KB     |
| 5    | FidelityBadge (共享 chunk)   | 137 KB    | 55 KB     |
| 6    | motion (framer-motion)       | 135 KB    | 44 KB     |
| 7    | RefrigerationBenchModule     | 53 KB     | 16 KB     |
| -    | **总计**                     | 2,566 KB  | 835 KB    |

**问题**：
1. `index` 140 KB 把 framer-motion + 大量 lucide-react 图标 + 部分 chart 类型一起拉进首屏。
2. `WaveformPanel`（底部波形面板）eager 渲染，把 recharts (gz 120 KB) 拖进首屏关键路径。
3. `CurriculumPanel`（默认隐藏的课程主线视图）eager import，无谓占用首屏字节。
4. `RefrigerationBenchModule` 把 SeasonalCop / Defrost / PartLoad / FourQuadrant 4 张分析卡片打成单文件 53 KB。
5. `public/assets/generated/*.png` 7 张 ~2MB 的 PNG（共 14 MB）跟着 dist 一起发，但 `AssetHero` 在所有模块中都没被消费（webp 也只在 picture fallback 路径用，实际渲染时都用 SVG/Canvas）。

## 二、改动清单

| # | 文件 | 改动 | 收益方向 |
|---|------|------|----------|
| 1 | `vite.config.ts` | manualChunks 增加 `react-vendor`、`lucide-icons` 两个独立 chunk | 把 44 个文件共享的 lucide 图标从 index 中剥离 |
| 2 | `src/components/layout/AppShell.tsx` | `WaveformPanel` 改成 `React.lazy()` + `Suspense` | recharts chunk 不再首屏阻塞 |
| 3 | `src/components/layout/SimulationPanel.tsx` | `CurriculumPanel` 改 lazy | 课程主线 25 KB 推出首屏 |
| 4 | `src/components/layout/WaveformPanel.tsx` | `BenchScope` 改 lazy（仅 refrigeration-bench 分支用） | BenchScope + vaporCycle 推出 WaveformPanel chunk |
| 5 | `src/components/workshop/AssemblyWorkshop.tsx` | `SystemSchematic` 改 lazy | 27 KB SVG 拓扑图独立 chunk；Workshop 主体 -25 KB raw |
| 6 | `src/modules/refrigeration-bench/RefrigerationBenchModule.tsx` | 4 张分析 Card 全部 lazy | 53 KB → 25 KB 主入口，4 张卡共 25 KB 各自独立 |
| 7 | `scripts/analyze-bundle.mjs` | 重写：top-N 排序 + 分类汇总 + 图片审计 + 机器可读末行 | 后续审计直接 `node analyze-bundle.mjs` |
| 8 | `tests/e2e/perf-prod.spec.ts` | 新增生产构建模块首挂时延测量 | 数字化卡线 |

不动的：math/、store、layout shell 主结构、Tailwind、modules/* 算法、walkthroughs、charts/。

## 三、收益（优化后）

```
TOP 6 CHUNKS:
rank  raw_kb   gz_kb    name
   1  1051.9   294.5    three          ← 与之前一致（已 lazy + tree-shaked 到底）
   2   414.9   117.8    charts         ← 与之前一致（拆分劣化加载并行度，见下）
   3   145.6    47.0    AssemblyWorkshopModule  ← -4.4 KB / -0.0 gz
   4   132.3    52.6    FidelityBadge  ← 与之前一致（已是共享 chunk）
   5   123.3    40.4    motion         ← -11.3 KB / -3.9 gz
   6    80.5    25.8    index          ← -59.5 KB / -22.0 KB gz（关键路径首屏入口大幅瘦身）

new chunks below the fold:
       26.2     7.8    SystemSchematic
       25.4     9.4    lucide-icons
       24.8     8.8    CurriculumPanel
       24.4     7.5    RefrigerationBenchModule  ← -28.6 KB raw / -8.5 KB gz
       8.4     3.0    WaveformPanel
       3.3     1.6    BenchScope
       ~6-8    各 ~3   SeasonalCop / Defrost / PartLoad / FourQuadrant 4 张卡
```

**首屏关键路径估算**（不含 module 自身 chunk）：

| | 优化前 | 优化后 | 差量 |
|---|---|---|---|
| index | 48 KB gz | 26 KB gz | **-22 KB** |
| 必须立即下载的 vendor | motion (44) + charts (121) | motion (40) + lucide (9) | **-116 KB** |
| 首屏关键路径合计 | ~213 KB gz | ~75 KB gz | **-138 KB (≈ -65%)** |

之后用户激活某个模块再按需下载 charts / recharts、module 自己的 chunk。

**总体 gzip**：835 KB → 845 KB（+1.2%，符合预期：拆分多出来 5-8 个 chunk 头部 overhead 是合理代价；总解码字节数差不多但首屏并发请求结构更好）。

## 四、生产 build 模块首挂时延（实测）

`tests/e2e/perf-prod.spec.ts` 跑 `vite preview` (port 4173) 真实生产 bundle：

| Module | Click → "教学讲义" 可见 |
|---|---|
| motor-basics | 597 ms |
| clarke-transform | 513 ms |
| pid-control | 447 ms |

motor-basics 慢主要在 `Motor3D` lazy chunk 把 three.js (302 KB gz) 拉下来 + R3F Canvas mount。Clarke / PID 两个不涉及 3D 的纯 SVG 模块都已经 ≤ 520 ms。

dev-mode（vite serve）对比：1082 / 591 / 516 ms，dev 多出来的是 Vite on-demand transform + sourcemap。

## 五、Trade-off / 不做项

1. **`recharts` 不再尝试拆 Bar / Line / Area / RadialBar sub-chunk**：内部 `CategoricalChartWrapper` / `Tooltip` / `CartesianGrid` / `XAxis` / `YAxis` 等被 30+ 个 chart 子组件共享。一旦拆细：每个模块改成请求 4-6 个 chunk，浏览器并发预算（HTTP/1.1 是 6，HTTP/2 也是有限的）会被吃完，反而劣化加载并行度。保留单个 charts chunk + `React.lazy()` 边界（WaveformPanel + 各模块自己），是最优解。
2. **`three.js` 暂不拆**：当前 drei 只用了 `OrbitControls` 一个 helper，tree-shaking 已经做到极限（drei 自身就支持 named export 摇树）。如果只要看 motor-basics 的 2D 解剖图但不打开 3D 旋转，three 不会下载（Motor3D 是 lazy）。
3. **`AssetHero` 路径上的 PNG 资源**：14 MB 跟着 dist 一起发但实际从来没被消费——所有模块改用纯 SVG/Canvas 表达后 `AssetHero` 失去 caller。**verify-project.mjs 强制要求这 14 个 PNG/WEBP 存在**（[scripts/verify-project.mjs:116-130](../scripts/verify-project.mjs#L116)），且 README / docs/ASSET_PIPELINE.md 也引用，本轮不删。**下一轮建议**：要么把 verify 改成允许缺失 + 在 AssetHero 找不到时静默 fallback，要么把图片做成可选 download 包。
4. **`FidelityBadge-*.js` 137 KB chunk 不动**：这是 Rollup 自动产出的"被 ≥2 个 lazy entry 引用"的 shared chunk，里面是若干 lucide 图标 + 共享的 Card / Button / Tabs 模板的"按用频"切片。强行拆会让原本一次下载的 shared 代码变成 N 个模块各自下载，更慢。

## 六、后续优化（带优先级）

| 优先级 | 项 | 难度 | 收益估计 |
|---|---|---|---|
| **P1** | 把不再被引用的 14 MB PNG / 旧 webp 从 build 产物剥离（改 verify + AssetHero 容错） | 中（要改 verify-project + AssetHero） | desktop 安装包 -14 MB |
| P1 | 把 `Motor3D` / `RotorFluxScene` 改成 IntersectionObserver 触发懒挂载（先渲染占位 + "点击启用 3D"） | 中 | motor-basics 首挂 -200~300 ms |
| P2 | `lucide-react` 改成 ES module 静态导入 + 全局图标注册表（用 `@lucide/react/esm/icons/<name>` 单图标 import） | 高（44 个文件改 import） | lucide-icons chunk -50% 体积 |
| P2 | 把 `framer-motion` 改用 `motion/mini` API + 关掉 layout animations | 中（要审 ~10 个组件的 motion 用法） | motion chunk 44 KB → ~20 KB gz |
| P3 | `recharts` 替换为 `visx` 或纯 SVG（中长期项，重构 18 个 chart 组件） | 高 | charts chunk -60 KB gz |
| P3 | 把每个模块的 walkthrough 内容做成 lazy-evaluated content（已部分 lazy，但还可以更细） | 低 | -3~5 KB gz per module |

## 七、验证命令

```bash
npx tsc -b --noEmit          # 0 errors
npx vitest run               # 277 passed / 1 pre-existing failure (assembly-workshop walkthrough steps)
npm run build                # dist 重新产出
node scripts/analyze-bundle.mjs   # 看 top-20 + 分类
npm run verify               # 81 files + 16 modules 全过
```


---

## 八、v0.2 复测（2026-09-09 追加）

v0.2 双栏沉浸壳层重写 + 主包瘦身（887→423 kB）后，用修复过的 perf 工具复测生产首挂：

| Module | R2 基线 | v0.2 复测 | 变化 |
|---|---|---|---|
| motor-basics | 597 ms | 365 ms | -39% |
| clarke-transform | 513 ms | 152 ms | -70% |
| pid-control | 447 ms | 208 ms | -54% |

复测环境：`vite preview`（4173）生产 bundle，Click → "教学讲义" 可见，与 R2 同口径。

**后续优化项状态更新**：

- **P1 · 14 MB PNG 剥离**：已完成（`trim-png-fallbacks` vite 插件，dist/assets/generated/*.png 构建时删除，webp 0.68 MB 交付，AssetHero `<picture>` 实测正常）。
- **P1 · 3D IntersectionObserver 懒挂载**：已实现并**回滚**（2026-09-08）。桌面端 3D 场景基本首屏可见，收益集中于移动端长内容流；验证受阻于移动端滚动容器归属（window vs section）与 dev 模式竞态，且 preview 构建曾出现一次性 React #185。基于当时数据判断投入产出不足，回滚；如重试建议用"点击启用 3D"的确定性手势方案（R2 原建议），并先解决移动端滚动模型测试。
- **主包瘦身 887→423 kB**（-52%）：lessonsEn 惰性注册表 + AssistantPanel（RAG/LLM 链）/ 课程主线 / 学习洞察懒加载；英文讲义 141 kB、助手链等全部按需 chunk。
- **发布资产**：dist 图片 14.4 MB → 0.68 MB（-13.7 MB）。

复测命令：

```bash
npm run build && npx vite preview --port 4173 --strictPort &
PERF_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/perf-prod.spec.ts
```
