#!/usr/bin/env node
// Screenshot of an admin page, signed in: `pnpm cloud:shot <url-path> [out.png]`.
//
//   pnpm cloud:shot /donors                 → /tmp/shot.png
//   pnpm cloud:shot "/donors?q=kari" a.png
//
// Opens the running admin (ADMIN_URL, default http://localhost:3001), signs in with the "Sign in
// with dev token" button, goes to the path and saves a 1440×900 screenshot (SHOT_FULL_PAGE=1 for
// the whole page). Uses the admin's Playwright and PW_CHROMIUM_PATH when set (cloud sessions;
// docs/claude-cloud.md). Needs the dev stack: the admin and the mock login.
import { createRequire } from "node:module";
import { resolve } from "node:path";

const [path = "/", out = "/tmp/shot.png"] = process.argv.slice(2);
if (!path.startsWith("/")) {
  console.error("Usage: pnpm cloud:shot <url-path starting with /> [out.png]");
  process.exit(2);
}
const base = process.env.ADMIN_URL || "http://localhost:3001";
const outFile = resolve(process.env.INIT_CWD || process.cwd(), out);

const require = createRequire(new URL("../../apps/admin/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage({
    baseURL: base,
    viewport: { width: 1440, height: 900 },
    locale: "nb-NO",
    timezoneId: "Europe/Oslo",
  });
  // The login page sends us on to `redirect` once signed in. The token lives in sessionStorage,
  // so it lasts for this tab only.
  // Already signed in, it redirects at once.
  await page.goto(`/login?redirect=${encodeURIComponent(path)}`);
  const signIn = page.getByRole("button", { name: /dev token/i });
  const signedIn = (url) => url.pathname !== "/login";
  await Promise.race([signIn.waitFor({ timeout: 15_000 }), page.waitForURL(signedIn)]);
  if (!signedIn(new URL(page.url()))) {
    await signIn.click();
    await page.waitForURL(signedIn, { timeout: 15_000 });
  }
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: outFile, fullPage: process.env.SHOT_FULL_PAGE === "1" });
  console.log(`${outFile} (${page.url()})`);
} catch (error) {
  console.error(`cloud:shot failed: ${error instanceof Error ? error.message : error}`);
  console.error(`Is the admin up on ${base}? (cloud: /tmp/dev-env.ready, /tmp/admin-dev.log)`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
