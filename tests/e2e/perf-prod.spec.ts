// 生产 bundle 首挂时延测量 (performance audit R2)。
// 与 perf-module-mount.spec.ts 同样的测量逻辑，但通过环境变量 PERF_BASE_URL
// 指向 vite preview 端口（4173），跑真生产 chunk + minified。
//
// 默认不在 release-audit 的 e2e 集合里跑（playwright.config.ts 的 webServer 起的是 dev
// 5173 而不是 preview 4173）。手动跑法：
//   npm run build && npx vite preview --port 4173 &
//   PERF_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/perf-prod.spec.ts
//
// 没显式声明 PERF_BASE_URL 时整个 file skip，避免污染 release-audit。
import { expect, test, type Page } from '@playwright/test';

const PROD_BASE = process.env.PERF_BASE_URL;

test.skip(!PROD_BASE, 'PERF_BASE_URL not set; production perf measurement skipped');

const targets = [
  { stage: '01', label: 'motor-basics' },
  { stage: '03', label: 'clarke' },
  { stage: '05', label: 'pid' },
];

async function timeMount(page: Page, stage: string): Promise<number> {
  const start = await page.evaluate(() => performance.now());
  await page.locator('nav button').filter({ hasText: `${stage}` }).click();
  await expect(page.getByText('教学讲义').first()).toBeVisible({ timeout: 5000 });
  const end = await page.evaluate(() => performance.now());
  return end - start;
}

test('production build module mount latency', async ({ page }) => {
  await page.goto((PROD_BASE ?? 'http://127.0.0.1:4173') + '/');
  await expect(page.locator('nav button').filter({ hasText: '01' }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800);

  const results: Record<string, number> = {};
  for (const t of targets) {
    // 切到模块 08 (inverter) 作为对照模块，再切回来
    await page.locator('nav button').filter({ hasText: `08` }).click().catch(() => {});
    await page.waitForTimeout(300);
    results[t.label] = await timeMount(page, t.stage);
  }
  console.log('PERF_PROD_MODULE_MOUNT=' + JSON.stringify(results));
});
