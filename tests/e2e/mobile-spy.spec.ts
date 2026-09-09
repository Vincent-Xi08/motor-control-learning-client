import { expect, test } from '@playwright/test';

/**
 * 移动端卡片锚点 scroll-spy 守护（v0.2.2 修复的回归防护）。
 *
 * 背景：<xl 布局高度未约束，模块 section 撑到内容高、由 window 滚动；
 * spy 曾只监听 section 的 scroll，移动端从顶滚到底高亮纹丝不动。
 * 本测试在 390px 视口下滚动全程，断言高亮芯片随进度切换。
 */
test('mobile scroll-spy tracks card progression while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('tour.done', 'true');
    // 隔离语言影响：锚点标题两种语言都能断言（取第一张 vs 最后一张的差异即可）
    localStorage.setItem('compressor-bench-locale', '{"state":{"locale":"zh-CN"},"version":1}');
  });
  await page.goto('/');
  await page.locator('nav button').filter({ hasText: '09' }).first().click(); // 三闭环：13 张卡，链条最长
  await page.waitForTimeout(1000);

  const activeChip = () =>
    page.locator('[role="tablist"] [role="tab"][aria-selected="true"]').textContent().then((s) => s?.trim() ?? '');

  const top = await activeChip();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const bottom = await activeChip();

  expect(top, '顶部高亮应为第一张卡').toContain('级联');
  expect(bottom, '滚到底后高亮应切换（spy 冻结回归）').not.toEqual(top);
});
