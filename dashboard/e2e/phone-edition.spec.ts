// The mail client on a phone: Sent and Drafts take the tabs beside Compose, and More holds the rest.
import { expect, openInbox, test } from "./fixtures";

test("the tabs are Inbox, Sent, Drafts and More", async ({ page }) => {
  await openInbox(page);
  const nav = page.locator(".mobile-nav");
  await expect(nav.locator(".mobile-tab-label")).toHaveText(["Inbox", "Sent", "Drafts", "More"]);
  await nav.getByRole("button", { name: "Sent" }).tap();
  await expect(page).toHaveURL(/\/dashboard\/sent$/);

  await nav.getByRole("button", { name: "More" }).tap();
  const more = page.getByRole("dialog", { name: "More" });
  await expect(more.locator(".more-item")).toHaveText(["Archive", "Spam", "Trash", "Notifications", "Settings"]);
  await more.getByRole("button", { name: "Trash" }).tap();
  await expect(page).toHaveURL(/\/dashboard\/trash$/);
});
