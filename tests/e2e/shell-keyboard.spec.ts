import { expect, test } from '@playwright/test';

/**
 * 命令面板（Ctrl+K）与参数坞键盘流守护。
 *
 * v0.2 双栏沉浸壳层的核心交互：Ctrl+K 开面板 → 焦点入输入框 →
 * 中/英过滤 → Enter 直达模块并关面板；Esc 关参数坞。
 * 背景：交互流类回归 axe 扫不出来，只能靠真实键盘事件 e2e。
 */
test('command palette opens, filters bilingually, jumps to module', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('tour.done', 'true'));
  await page.goto('/');
  await page.waitForTimeout(500);

  // Ctrl+K 开面板，焦点自动入输入框
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(200);
  const input = page.locator('[role="dialog"] input');
  await expect(input).toBeFocused();

  // 中文过滤：输入"三相"应同时命中 02 三相磁场（shortTitle 含"三相"）
  await page.keyboard.type('三相磁场');
  await page.waitForTimeout(150);
  await expect(page.locator('[role="option"]').first()).toContainText('02');

  // 清空后英文过滤：svpwm
  await page.keyboard.press('Control+a');
  await page.keyboard.type('svpwm');
  await page.waitForTimeout(150);
  await expect(page.locator('[role="option"]').first()).toContainText('SVPWM');

  // Enter 直达模块且面板关闭
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await expect(page.locator('main h1').first()).toContainText('SVPWM');
  await expect(page.locator('[role="dialog"][aria-label*="快速跳转"]')).toHaveCount(0);
});

test('parameter dock toggles from top bar and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('tour.done', 'true'));
  await page.goto('/');
  await page.waitForTimeout(500);

  // 顶栏「参数」展开 dock（aside 参数控制台出现）
  const toggle = page.getByRole('button', { name: '参数', exact: true }).first();
  await toggle.click();
  await expect(page.locator('aside[aria-label="参数控制台"]')).toBeVisible();

  // Esc 关闭
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(page.locator('aside[aria-label="参数控制台"]')).toHaveCount(0);
});

test('keyboard help overlay opens with ? and lists Ctrl+K', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('tour.done', 'true'));
  await page.goto('/');
  await page.waitForTimeout(500);

  // `?`（Shift+Slash）打开帮助
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(300);
  const overlay = page.locator('[role="dialog"]').last();
  await expect(overlay).toBeVisible();
  // Ctrl+K 已登记进帮助（v0.2 集中注册）
  await expect(overlay).toContainText('Ctrl');
  await expect(overlay).toContainText('K');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
});
