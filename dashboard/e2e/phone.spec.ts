import type { Page } from "@playwright/test";
import { expect, openInbox, row, test } from "./fixtures";

async function swipe(page: Page, selector: string, dx: number, dy: number) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  const startX = box.x + 40;
  const startY = box.y + 60;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 10 });
  await page.mouse.up();
}

/** A destination from the bottom navigation: its own tab in one edition, under More in the other. */
async function goTo(page: Page, name: string) {
  const tab = page.locator(".mobile-nav").getByRole("button", { name, exact: true });
  if (await tab.isVisible()) return tab.tap();
  await page.locator(".mobile-nav").getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name, exact: true }).tap();
}

test("one column with a bottom navigation, and a swipe back from a message", async ({ page }) => {
  await openInbox(page);
  await expect(page.locator(".sidebar")).toBeHidden();
  const nav = page.locator(".mobile-nav");
  await expect(nav).toBeVisible();
  await expect(nav.locator(".g-badge")).toHaveText("3");

  await row(page, "Your verification code").tap();
  await expect(page.getByRole("heading", { name: "Your verification code" })).toBeVisible();
  await expect(nav).toBeHidden();
  await expect(page.locator(".list")).toBeHidden();

  await swipe(page, ".detail-inner", 220, 4);
  await expect(page).toHaveURL(/\/dashboard\/inbox$/);
  await expect(nav).toBeVisible();
});

test("the composer covers the screen and keeps the draft when minimized", async ({ page }) => {
  await openInbox(page);
  await page.getByRole("button", { name: "Compose" }).tap();
  const composer = page.getByRole("dialog", { name: "New message" });
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
  expect(Math.round(box?.height ?? 0)).toBe(viewport?.height);

  await composer.getByLabel("Subject").fill("Borrador desde el teléfono");
  await composer.getByRole("button", { name: "Close" }).tap();
  const pill = page.locator(".draft-pill");
  await expect(pill).toHaveText("Borrador desde el teléfono");
  await pill.tap();
  await expect(composer.getByLabel("Subject")).toHaveValue("Borrador desde el teléfono");
});

test("settings open as a bottom sheet that closes with a swipe down", async ({ page }) => {
  await openInbox(page);
  await page.locator(".mobile-nav").getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Settings" }).tap();
  const sheet = page.getByRole("dialog", { name: "Settings" });
  await expect(sheet).toBeVisible();
  // Once its spring settles, the sheet rests on the bottom edge.
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return Math.round((box?.y ?? 0) + (box?.height ?? 0));
    })
    .toBe(page.viewportSize()?.height);

  // The More sheet slides away as Settings opens; swipe only once it has gone.
  await expect(page.getByRole("dialog", { name: "More" })).toBeHidden();
  await swipe(page, ".sheet-grabber", 0, 260);
  await expect(sheet).toBeHidden();
});

test("a tap on refresh brings in new mail without reloading the page", async ({ page }) => {
  await openInbox(page);
  await page.request.post("/dashboard/api/__mock/arrive");
  const refresh = page.locator(".list").getByRole("button", { name: "Refresh" });
  const box = await refresh.boundingBox();
  // A comfortable touch target in the list header.
  expect(box?.width).toBeGreaterThanOrEqual(36);
  await refresh.tap();
  await expect(row(page, "GEO-42 moved to In review")).toBeVisible();
  await expect(page.locator(".mobile-nav .g-badge")).toHaveText("4");
});

test("More reaches Archive and Trash on a phone", async ({ page }) => {
  await openInbox(page);
  await row(page, "CI passed on main").tap();
  await page.getByRole("button", { name: "Archive (E)" }).tap();
  await expect(page.locator(".toast", { hasText: "Archived" })).toBeVisible();
  // The next message opens in its place; Back returns to the list and its tab bar.
  await page.getByRole("button", { name: "Back" }).tap();
  await page.locator(".mobile-nav").getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Archive" }).tap();
  await expect(page).toHaveURL(/\/dashboard\/archive$/);
  await expect(row(page, "CI passed on main")).toBeVisible();
  await page.locator(".mobile-nav").getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Trash" }).tap();
  await expect(page.getByText("Trash is empty")).toBeVisible();
  await page.locator(".mobile-nav").getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Spam" }).tap();
  await row(page, "Your account is limited").tap();
  await expect(page.locator(".spam-banner")).toBeVisible();
});

test("search works on a phone", async ({ page }) => {
  await openInbox(page);
  const search = page.getByRole("searchbox", { name: "Search mail" });
  await search.tap();
  await search.fill("github");
  await search.press("Enter");
  await expect(page.locator("button.msg")).toHaveCount(1);
  await row(page, "CI passed on main").tap();
  await expect(page.locator(".subject-title")).toContainText("CI passed on main");
  await page.getByRole("button", { name: "Back" }).tap();
  await expect(page).toHaveURL(/\/dashboard\/search#q=github$/);
});

test("files can be attached on a phone", async ({ page }) => {
  await openInbox(page);
  await page.locator(".mobile-compose").tap();
  const composer = page.getByRole("dialog", { name: "New message" });
  await composer.getByTestId("attach-input").setInputFiles({
    name: "foto.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff]),
  });
  await expect(composer.locator('.g-file-chip[data-state="ready"]')).toHaveText(/foto\.jpg/);
  await composer.getByRole("button", { name: "Remove foto.jpg" }).tap();
  await expect(composer.locator(".g-file-chip")).toHaveCount(0);
});

test("old mail can be imported from a phone", async ({ page }) => {
  await openInbox(page);
  await page.locator(".mobile-nav").getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Settings" }).tap();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Import mail" }).tap();
  const dialog = page.getByRole("dialog", { name: "Import mail" });
  await dialog.getByTestId("import-input").setInputFiles({
    name: "uno.eml",
    mimeType: "message/rfc822",
    buffer: Buffer.from("From: a@b.cl\r\nSubject: Desde el teléfono\r\nMessage-ID: <phone@x>\r\n\r\nHola"),
  });
  await dialog.getByRole("button", { name: "Start import" }).tap();
  await expect(dialog.getByText("Done: 1 message imported.")).toBeVisible();
});

test("More reaches Notifications on a phone", async ({ page }) => {
  await openInbox(page);
  await page.locator(".mobile-nav").getByRole("button", { name: "More" }).tap();
  await page.getByRole("dialog", { name: "More" }).getByRole("button", { name: "Notifications" }).tap();
  await expect(page).toHaveURL(/\/dashboard\/notifications$/);
  await expect(page.locator("p.registered-email")).toHaveText("owner@example.org");
});

test("Drafts are reachable on a phone and open in the composer", async ({ page }) => {
  await openInbox(page);
  await page.locator(".mobile-compose").tap();
  const composer = page.getByRole("dialog", { name: "New message" });
  await composer.getByLabel("Subject").fill("Desde el teléfono");
  await expect(composer.getByText("Draft saved")).toBeVisible();
  await composer.getByRole("button", { name: "Close" }).tap();
  await goTo(page, "Drafts");
  await page.locator(".draft-row", { hasText: "Desde el teléfono" }).locator(".draft-open").tap();
  await expect(page.getByRole("dialog", { name: "New message" }).getByLabel("Subject")).toHaveValue(
    "Desde el teléfono",
  );
});

test("first-run setup fits a phone", async ({ page }) => {
  await page.request.post("/dashboard/api/__mock/fresh");
  await page.goto("/dashboard/inbox");
  const setup = page.getByRole("region", { name: "Set up your mailbox" });
  await expect(setup).toBeVisible();
  const box = await setup.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);
  await expect(setup.locator(".brand-name")).toBeVisible();
  await setup.getByRole("button", { name: "Create the mailbox" }).tap();
  await expect(page.locator(".mobile-nav")).toBeVisible();
});

test("aliases can be added from the Settings sheet on a phone", async ({ page }) => {
  await openInbox(page);
  await goTo(page, "Settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Add alias" }).tap();
  await expect(settings.locator(".alias-row")).toHaveCount(2);
  const added = settings.locator(".alias-row").nth(1);
  await expect(added).toContainText("contact@example.com");
  const box = await added.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.x + box.width <= viewport.width).toBe(true);
});

test("sender avatars switch to initials from the Settings sheet on a phone", async ({ page }) => {
  await openInbox(page);
  await goTo(page, "Settings");
  await page.getByRole("dialog", { name: "Settings" }).getByLabel("Sender avatars").selectOption("initials");
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close settings" }).tap();
  await expect(page.locator("button.msg .avatar-initials").first()).toBeVisible();
});

test("a preference changed on a phone is saved for every device", async ({ page }) => {
  await openInbox(page);
  await goTo(page, "Settings");
  const saved = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/dashboard/api/mailbox/preferences"),
  );
  await page.getByRole("dialog", { name: "Settings" }).getByLabel("Time format").selectOption("12h");
  expect((await saved).postDataJSON()).toMatchObject({ clock: "12h" });
});

test("a new release can be applied from the Settings sheet on a phone", async ({ page }) => {
  await page.request.post("/dashboard/api/__mock/update-available");
  await openInbox(page);
  await goTo(page, "Settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Update…" }).tap();
  const dialog = page.getByRole("dialog", { name: "Update Georg mail" });
  await dialog.getByRole("button", { name: "Update to 0.2.0" }).tap();
  await expect(dialog.getByText(/is committed to github\.com\/owner\/mail/)).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
});

test("taps sound on a phone, and the Settings sheet can silence them", async ({ page }) => {
  await page.addInitScript(() => {
    const heard: string[] = [];
    (window as unknown as { __sounds: string[] }).__sounds = heard;
    window.addEventListener("georg:sound", (event) => heard.push((event as CustomEvent<string>).detail));
  });
  const sounds = () => page.evaluate(() => (window as unknown as { __sounds: string[] }).__sounds.slice());
  await openInbox(page);
  await row(page, "Your verification code").tap();
  await expect.poll(sounds).toContain("tick");
  await page.getByRole("button", { name: "Back" }).tap();
  await goTo(page, "Settings");
  await page.getByRole("switch", { name: "Interface sounds" }).tap();
  await expect.poll(async () => (await sounds()).at(-1)).toBe("toggleOff");
  await expect(page.getByRole("switch", { name: "Interface sounds" })).not.toBeChecked();
});
