import { expect, test, type Page } from "@playwright/test";
import {
  donationFixture,
  overviewFixture,
  pledgesFixture,
  stubAnalysisApi,
  tickerYearFixture,
} from "../analysis-fixtures";

/** The analysis pages against a stubbed API: the count-up, and adding and closing pledges. */
const osloToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });

async function signIn(page: Page, overrides = {}) {
  await stubAnalysisApi(page, { overrides });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
}

test("the through-time figure counts up once without moving anything", async ({ page }) => {
  // Record every value the figure shows, and the width of its box, from the first paint
  await page.addInitScript(() => {
    const seen: { text: string; width: number }[] = [];
    (window as unknown as { countUp: typeof seen }).countUp = seen;
    new MutationObserver(() => {
      const el = document.querySelector("[data-slot=count-up]");
      const text = el?.textContent?.replace(/\s/g, " ");
      if (el && text && text !== seen.at(-1)?.text)
        seen.push({ text, width: (el.parentElement as HTMLElement).offsetWidth });
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await signIn(page);
  // Navigate within the app, so the brand font is already in (the fallback font is wider)
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const figure = page.locator("[data-slot=count-up]");
  await expect(figure).toHaveText("170 245 588 kr");
  await page.waitForTimeout(300);
  const seen = await page.evaluate(
    () => (window as unknown as { countUp: { text: string; width: number }[] }).countUp,
  );
  expect(seen.length).toBeGreaterThan(3);
  expect(seen.at(-1)!.text).toBe("170 245 588 kr");
  // The box is as wide as the total from the first value on, within subpixel rendering: up to
  // 2px at the display size (text-display), where the brand font's digits differ slightly
  const final = seen.at(-1)!.width;
  for (const { width } of seen) expect(Math.abs(width - final)).toBeLessThanOrEqual(2);
  // Screen readers get the total only
  await expect(page.getByText("170 245 588 kr", { exact: true }).last()).toHaveClass(/sr-only/);
});

test("under reduced motion the total shows at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.goto("/analysis");
  const figure = page.locator("[data-slot=count-up]");
  await expect(figure).toBeVisible();
  // Read once, without retrying: the first value shown is already the total
  expect((await figure.textContent())?.replace(/\s/g, " ")).toBe("170 245 588 kr");
});

test("the overview refreshes every minute and the figure follows new donations", async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  let calls = 0;
  await signIn(page, {
    "analysis.overview": () => {
      calls++;
      const overview = overviewFixture();
      // From the second call on, a donation of 4 412 kr has come in
      return calls === 1
        ? overview
        : { ...overview, withPledges: { ...overview.withPledges, sum: "170250000" } };
    },
  });
  await page.goto("/analysis");
  const figure = page.locator("[data-slot=count-up]");
  await expect(figure).toHaveText("170 245 588 kr");
  const before = calls;
  await page.clock.fastForward(61_000);
  await expect.poll(() => calls).toBeGreaterThan(before);
  await expect(figure).toHaveText("170 250 000 kr");
});

test("the office screen shows the figure without signing in and keeps it fresh", async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const ticker = { sum: "170245588", estimate: null, year: tickerYearFixture };
  let calls = 0;
  let failing = false;
  const authHeaders: (string | undefined)[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/trpc/analysis.ticker"))
      authHeaders.push(request.headers().authorization);
  });
  await stubAnalysisApi(page, {
    overrides: {
      "analysis.ticker": () => {
        calls++;
        if (failing)
          return { error: { code: "INTERNAL_SERVER_ERROR", message: "db down", httpStatus: 500 } };
        return calls === 1 ? ticker : { ...ticker, sum: "170250000" };
      },
    },
  });
  // Straight to the screen, never through /login
  await page.goto("/ticker");
  await expect(page).toHaveURL(/\/ticker$/);
  const figure = page.locator("[data-slot=count-up]");
  await expect(figure).toHaveText("170 245 588 kr");
  await expect(page.getByRole("img", { name: "Gi Effektivt" })).toBeVisible();
  // No menu: only the figure
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect(authHeaders.length).toBeGreaterThan(0);
  expect(authHeaders.every((header) => header === undefined)).toBe(true);

  // A failed refresh (after its retries) keeps the last figure on screen and says so
  failing = true;
  await page.clock.fastForward(61_000);
  await page.clock.fastForward(10_000);
  await expect(page.getByText(/couldn't update, trying again/)).toBeVisible();
  await expect(figure).toHaveText("170 245 588 kr");

  // The next minute tries again and brings it up to date
  failing = false;
  await page.clock.fastForward(61_000);
  await expect(figure).toHaveText("170 250 000 kr");
  await expect(page.getByText(/couldn't update/)).toHaveCount(0);
});

test("the office screen adds the agreements' estimate, ticks on and never goes back", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-11-09T12:00:00Z") });
  let calls = 0;
  let sum = "170245588";
  let since = "2026-11-09T10:00:00.000Z";
  await stubAnalysisApi(page, {
    overrides: {
      // 0.5 kr a second since 10:00: about 3 600 kr not registered yet at noon
      "analysis.ticker": () => {
        calls++;
        return { sum, estimate: { perSecond: 0.5, since }, year: tickerYearFixture };
      },
    },
  });
  const kroner = async () =>
    Number((await page.locator("[data-slot=count-up]").textContent())!.replace(/\D/g, ""));
  await page.goto("/ticker");
  await expect(page.getByText(/^Updated/)).toBeVisible();
  // The screen only says when it was updated, not that an estimate is included
  await expect(page.getByText(/estimate/i)).toHaveCount(0);
  // From here on the figure moves only when the test lets time run
  await page.clock.pauseAt(new Date("2026-11-09T12:00:10Z"));
  await page.clock.runFor(100);
  const start = await kroner();
  expect(start).toBeGreaterThanOrEqual(170_249_188);
  expect(start).toBeLessThan(170_249_200);

  // Ten seconds later it has ticked on by 5 kr
  await page.clock.runFor(10_000);
  expect(await kroner()).toBe(start + 5);

  // The agreement money up to 11:59 is registered, below the estimate: at the next refresh
  // the figure holds still instead of going back
  sum = "170248000";
  since = "2026-11-09T11:59:00.000Z";
  const before = calls;
  await page.clock.runFor(60_000);
  await expect.poll(() => calls).toBeGreaterThan(before);
  await page.clock.runFor(100);
  const held = await kroner();
  await page.clock.runFor(10_000);
  expect(await kroner()).toBe(held);
});

test("the office screen follows a drop larger than a day's flow down", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-09T12:00:00Z") });
  let calls = 0;
  let sum = "170245588";
  await stubAnalysisApi(page, {
    overrides: {
      "analysis.ticker": () => {
        calls++;
        return {
          sum,
          estimate: { perSecond: 0.5, since: "2026-11-09T10:00:00.000Z" },
          year: tickerYearFixture,
        };
      },
    },
  });
  const kroner = async () =>
    Number((await page.locator("[data-slot=count-up]").textContent())!.replace(/\D/g, ""));
  await page.goto("/ticker");
  await expect(page.getByText(/^Updated/)).toBeVisible();
  await page.clock.pauseAt(new Date("2026-11-09T12:00:10Z"));
  await page.clock.runFor(100);
  expect(await kroner()).toBeGreaterThan(170_245_588);

  // A donation of about 1.2 million kr deleted: far more than a day's flow (43 200 kr)
  sum = "169000000";
  const before = calls;
  await page.clock.runFor(60_000);
  await expect.poll(() => calls).toBeGreaterThan(before);
  await page.clock.runFor(100);
  expect(await kroner()).toBeLessThan(169_100_000);
});

test("the office screen shows this year against the goal, split by gift size", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubAnalysisApi(page);
  await page.goto("/ticker");
  const year = page.getByRole("region", { name: "2026 against the goal" });
  await expect(year).toContainText("2026 so far: 22,6 mill. kr");
  await expect(year).toContainText("of 78 mill. kr");
  const small = year.getByRole("progressbar", { name: "Gifts under 100 000 kr" });
  await expect(small).toHaveAttribute("aria-valuetext", "14,8 mill. kr of 28 mill. kr");
  const large = year.getByRole("progressbar", { name: "Gifts of 100 000 kr or more" });
  await expect(large).toHaveAttribute("aria-valuetext", "7,8 mill. kr of 50 mill. kr");
  // The bars fill to their share of the goal: 53 % and 16 %
  const width = (bar: typeof small) =>
    bar.locator("[data-slot=ticker-bar]").evaluate((el) => (el as HTMLElement).style.width);
  await expect.poll(() => width(small)).toMatch(/^52\.7/);
  await expect.poll(() => width(large)).toMatch(/^15\.6/);
});

test("the office screen shows just the year so far without a goal", async ({ page }) => {
  await stubAnalysisApi(page, {
    overrides: {
      "analysis.ticker": () => ({
        sum: "170245588",
        estimate: null,
        year: { ...tickerYearFixture, year: 2031, goal: null },
      }),
    },
  });
  await page.goto("/ticker");
  await expect(page.getByText("2031 so far: 22,6 mill. kr")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("the overview links to the office screen", async ({ page }) => {
  await signIn(page);
  await page.goto("/analysis");
  await expect(page.getByRole("link", { name: "Show on a screen" })).toHaveAttribute(
    "href",
    "/ticker",
  );
});

test("adding a pledge validates inline, sends amount and date, and refetches the overview", async ({
  page,
}) => {
  const created: unknown[] = [];
  let overviewCalls = 0;
  let pledges = pledgesFixture();
  await signIn(page, {
    "analysis.pledges.create": (input: unknown) => {
      created.push(input);
      const { sum, decidedDate } = input as { sum: number; decidedDate: string };
      const pledge = {
        id: 9,
        sum: sum.toFixed(2),
        decidedDate,
        receivedDate: null,
        donationId: null,
      };
      pledges = [pledge, ...pledges];
      return pledge;
    },
    "analysis.pledges.list": () => pledges,
    "analysis.overview": () => {
      overviewCalls++;
      return overviewFixture();
    },
  });
  // The overview is cached from the earlier visit, so a refetch after the change is visible
  await page.goto("/analysis");
  await expect(page.locator("[data-slot=count-up]")).toBeVisible();
  await page.getByRole("link", { name: "Pledges", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pledges" })).toBeVisible();

  await page.getByRole("button", { name: "Add pledge" }).click();
  const dialog = page.getByRole("dialog", { name: "Add pledge" });
  await dialog.getByRole("textbox", { name: "Amount" }).fill("12,345");
  await dialog.getByRole("button", { name: "Add pledge" }).click();
  await expect(dialog).toContainText("at most two decimals");
  expect(created).toEqual([]);

  await dialog.getByRole("textbox", { name: "Amount" }).fill("1 350 000,50");
  const before = overviewCalls;
  await dialog.getByRole("button", { name: "Add pledge" }).click();
  await expect(dialog).toBeHidden();
  expect(created).toEqual([{ sum: 1350000.5, decidedDate: osloToday() }]);
  await expect(page.getByRole("table", { name: "Pledges" })).toContainText("1 350 000,50 kr");
  // The overview was invalidated: going back fetches fresh numbers
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect.poll(() => overviewCalls).toBeGreaterThan(before);
});

test("marking received sends the date and donation; reopening can be undone", async ({ page }) => {
  const calls: { path: string; input: unknown }[] = [];
  const record = (path: string, result: (input: unknown) => unknown) => (input: unknown) => {
    calls.push({ path, input });
    return result(input);
  };
  const pledge = pledgesFixture()[0]!;
  await signIn(page, {
    "analysis.pledges.markReceived": record("markReceived", (input) => ({
      ...pledge,
      ...(input as object),
    })),
    "analysis.pledges.reopen": record("reopen", () => pledge),
    "analysis.pledges.delete": record("delete", () => ({ id: 3 })),
    "donations.get": (input: unknown) =>
      (input as { id: number }).id === 75625
        ? donationFixture
        : { error: { code: "NOT_FOUND", message: "Donation not found", httpStatus: 404 } },
  });
  await page.goto("/analysis/pledges");

  await page.getByRole("button", { name: "Mark received" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Donation ID" }).fill("999");
  await expect(dialog).toContainText("No donation has ID 999");
  await dialog.getByRole("textbox", { name: "Donation ID" }).fill("75625");
  await expect(dialog.getByRole("link", { name: "Donation #75625" })).toBeVisible();
  await dialog.getByRole("button", { name: "Mark as received" }).click();
  await expect(dialog).toBeHidden();
  expect(calls).toEqual([
    {
      path: "markReceived",
      input: { id: 7, receivedDate: osloToday(), donationId: 75625 },
    },
  ]);

  calls.length = 0;
  await page.getByRole("button", { name: "Reopen" }).first().click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Change undone")).toBeVisible();
  expect(calls).toEqual([
    { path: "reopen", input: { id: 4 } },
    { path: "markReceived", input: { id: 4, receivedDate: "2026-05-11", donationId: 75625 } },
  ]);

  calls.length = 0;
  await page.getByRole("button", { name: /^Delete the pledge of 750 000,00 kr/ }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("The open pledges on the overview go down by 750 000,00 kr");
  await confirm.getByRole("button", { name: "Delete pledge" }).click();
  await expect(confirm).toBeHidden();
  expect(calls).toEqual([{ path: "delete", input: { id: 3 } }]);
});

test("cohorts switch between donors and volume, and new donors stack by referral", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const table = page.getByRole("table", { name: "Donor cohorts" });
  const row2024 = table.getByRole("row", { name: /^2024/ });
  await expect(row2024).toContainText("35 %");
  await expect(table.getByRole("columnheader", { name: "2026 (so far)" })).toBeVisible();

  await page.getByRole("radio", { name: "Volume" }).click();
  await expect(row2024).toContainText("4 000 000".replace(/ /g, " "));
  await expect(row2024).not.toContainText("35 %");

  await expect(page.getByText("Effektiv altruisme")).toHaveCount(0);
  await page.getByRole("radio", { name: "By referral" }).click();
  await expect(page.getByText("Effektiv altruisme")).toBeVisible();
  await expect(page.getByText("Other / unknown", { exact: true })).toBeVisible();
});
