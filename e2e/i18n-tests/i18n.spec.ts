import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4777") return route.continue();
    if (url.host === "127.0.0.1:59999") return route.fulfill({ json: { name: "User server 名称", description: "User description", members: "2", joinPolicy: "open", identityTiers: ["local"] }, headers: { "access-control-allow-origin": "*" } });
    return route.fulfill({ status: 200, json: {}, headers: { "access-control-allow-origin": "*" } });
  });
});

test("system detection, language setting, persistence and reactive dialog", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { value: ["zh-CN", "en"] }));
  await page.goto("/e2e/i18n-harness.html");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible();
  await expect(page.getByTestId("search")).toContainText("microphone-volume");
  await page.getByRole("button", { name: "Open invite" }).click();
  await expect(page.getByRole("heading", { name: "服务器邀请" })).toBeVisible();
  await expect(page.getByText("User server 名称")).toBeVisible();
  await page.getByRole("button", { name: "接受邀请" }).click();
  await expect(page.getByRole("alert")).toContainText("邀请码无效");
  await page.evaluate(() => { localStorage.setItem("gryt.ui.language", "en"); window.dispatchEvent(new StorageEvent("storage", { key: "gryt.ui.language" })); });
  await expect(page.getByRole("heading", { name: "Server Invite" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Invalid invite code");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("gryt.ui.language"))).toBe("zh-CN");
  await page.screenshot({ path: "e2e/i18n-results/zh-CN-desktop.png" });
});

test("blocked preference storage switches this session; system changes follow only in system mode", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["ja-JP"] });
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === "gryt.ui.language") throw new Error("blocked"); write.call(this, key, value); };
  });
  await page.goto("/e2e/i18n-harness.html");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.evaluate(() => { Object.defineProperty(navigator, "languages", { configurable: true, value: ["zh-CN"] }); window.dispatchEvent(new Event("languagechange")); });
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.evaluate(() => window.dispatchEvent(new Event("languagechange")));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
});

test("late desktop-style storage restoration refreshes language without modifying other data", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { value: ["en-US"] }));
  await page.goto("/e2e/i18n-harness.html");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.evaluate(() => { localStorage.setItem("gryt.ui.language", "zh-CN"); localStorage.setItem("fixture.identity", "unchanged-fixture"); });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Restore preference" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  expect(await page.evaluate(() => localStorage.getItem("fixture.identity"))).toBe("unchanged-fixture");
});

test("narrow Chinese layout and emoji labels remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("gryt.ui.language", "zh-CN"));
  await page.goto("/e2e/i18n-harness.html");
  await page.getByRole("button", { name: "插入表情" }).click();
  await expect(page.getByPlaceholder("搜索表情…")).toBeVisible();
  await page.getByPlaceholder("搜索表情…").fill("not_an_emoji_987");
  await expect(page.getByText("没有找到表情")).toBeVisible();
  await page.screenshot({ path: "e2e/i18n-results/zh-CN-narrow.png" });
});

test("guest application shell starts in Chinese without hardware or external services", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("gryt.ui.language", "zh-CN");
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Headless fixture", "NotAllowedError"); };
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "欢迎使用 Gryt" })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: "我自己看看" })).toBeVisible();
  await page.getByRole("button", { name: "我自己看看" }).click();
  await page.getByRole("button", { name: "设置与账号", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await expect(page.getByPlaceholder("搜索设置")).toBeVisible();
  const nickname = page.getByPlaceholder("输入昵称");
  await nickname.fill("中文昵称 Alice");
  await nickname.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(nickname).toBeFocused();
  await nickname.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  await expect(nickname).toBeFocused();
  await nickname.press("Enter");
  await expect(nickname).not.toBeFocused();
  await page.getByPlaceholder("搜索设置").fill("语言");
  await page.getByPlaceholder("搜索设置").dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(page.getByPlaceholder("搜索设置")).toBeFocused();
  await expect(page.getByPlaceholder("搜索设置")).toHaveValue("语言");
  await page.locator(".gryt-settings-result").filter({ hasText: "语言" }).first().click();
  await expect(page.locator('[data-setting="language"]')).toBeVisible();
  await expect(page.getByRole("combobox", { name: "语言", exact: true })).toBeVisible();
  await page.screenshot({ path: "e2e/i18n-results/zh-CN-guest-settings.png" });
  expect(errors).toEqual([]);
});

test("IME Enter keeps draft, ordinary Enter sends, Shift Enter stays in editor", async ({ page }) => {
  await page.goto("/e2e/i18n-harness.html");
  const editor = page.getByRole("textbox").first();
  await editor.fill("中文测试 Alice");
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(page.getByTestId("sent")).toHaveText("[]");
  await expect(editor).toHaveText("中文测试 Alice");
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229 });
  await expect(page.getByTestId("sent")).toHaveText("[]");
  await editor.press("Enter");
  await expect(page.getByTestId("sent")).toHaveText('["中文测试 Alice"]');
  await editor.fill("下一行");
  await editor.press("Shift+Enter");
  await expect(page.getByTestId("sent")).toHaveText('["中文测试 Alice"]');
});
