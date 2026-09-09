// 模块首挂时延测量 (performance audit R2)。
// 启动 vite dev（playwright.config.ts 已起 webServer），点击 sidebar 切到目标模块，
// 测从 click 起到 "教学讲义" 元素可见为止的时延。
//
// 默认不在 release-audit 的 e2e 集合里跑——release-audit 已经在跑 smoke + a11y，
// 不需要额外的耗时测量。手动跑法：
//   PERF_MEASURE=1 npx playwright test tests/e2e/perf-module-mount.spec.ts --reporter=line
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.PERF_MEASURE, 'PERF_MEASURE not set; perf measurement skipped in release-audit');

const targets = [
  { stage: '01', title: '电机基础', label: 'motor-basics' },
  { stage: '03', title: 'Clarke 变换', label: 'clarke' },
  { stage: '05', title: 'PID 控制', label: 'pid' },
];

async function timeModuleMount(page: Page, stage: string, title: string): Promise<number> {
  // 用 page.evaluate 起 performance.now() 锚点；点击后等"教学讲义"可见。
  const start = await page.evaluate(() => performance.now());
  await page.locator('nav button').filter({ hasText: `${stage}` }).click();
  await expect(page.getByRole('heading', { name: title }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('教学讲义').first()).toBeVisible({ timeout: 5000 });
  const end = await page.evaluate(() => performance.now());
  return end - start;
}

test('module first-mount latency (production build via preview)', async ({ page }) => {
  await page.goto('/');
  // 等首屏稳定：sidebar 可见 + 首个模块 heading 渲染（任何 heading 即可）
  await expect(page.locator('nav button').filter({ hasText: '01' }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);

  const results: Record<string, number> = {};
  for (const t of targets) {
    // 切到一个对照模块再切回来，避免缓存命中拉低数字
    await page.locator('nav button').filter({ hasText: `08` }).click().catch(() => {});
    await page.waitForTimeout(200);
    results[t.label] = await timeModuleMount(page, t.stage, t.title);
  }

  // 输出 JSON 行，方便上层解析
  console.log('PERF_MODULE_MOUNT=' + JSON.stringify(results));
});
