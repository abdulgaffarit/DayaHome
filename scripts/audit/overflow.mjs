/**
 * Measures real horizontal overflow at every target width, and names the
 * elements responsible — so fixes target actual offenders rather than guesses.
 *
 * Run the dev server first, then:
 *   PROP_PATH=/property/<slug> node scripts/audit/overflow.mjs
 *
 * A clean run prints "NO HORIZONTAL OVERFLOW at any tested width."
 * Optional env: WIDTHS (comma-separated), SHOTS (routes to screenshot).
 */
import fs from "node:fs";
import { chromium } from "playwright";

const WIDTHS = (process.env.WIDTHS ?? "320,360,375,390,414,768,820,1024,1280").split(",").map(Number);
const BASE = "http://localhost:3000";

const ROUTES = process.argv[2]
  ? process.argv[2].split(",")
  : [
      "/", "/search", "/basha-bikri", "/basha-vhara", "/jomi-bikri", "/jomi-vhara",
      "/dokaan-vhara", "/office-vhara", "/godown-vhara", "/mess", "/sublet",
      "/how-it-works", "/contact", "/privacy", "/terms", "/advertise",
      "/login", "/register", "/forgot-password", "/reset-password",
      "__PROPERTY__",
      "/post-ad", "/dashboard", "/dashboard/properties", "/dashboard/favorites",
      "/dashboard/payments", "/dashboard/unlocked", "/dashboard/profile",
      "/advertiser", "/advertiser/payments",
      "/admin", "/admin/users", "/admin/properties", "/admin/properties/pending",
      "/admin/payments", "/admin/payments/gateways", "/admin/unlocks",
      "/admin/settings", "/admin/reports", "/admin/logs", "/admin/admins",
      "/admin/advertising", "/admin/advertising/approvals", "/admin/advertising/campaigns",
      "/admin/advertising/advertisers", "/admin/advertising/zones",
      "/admin/advertising/packages", "/admin/advertising/analytics",
    ];

const SHOT_ROUTES = new Set(
  (process.env.SHOTS ?? "").split(",").filter(Boolean),
);
if (SHOT_ROUTES.size) fs.mkdirSync(".audit/shots", { recursive: true });

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});

// Sign in exactly once and reuse the cookie for every width. Logging in per
// context trips the login rate limiter, and the later widths then silently
// measure the login page instead of the admin and dashboard routes.
async function signInOnce(identifier) {
  const context = await browser.newContext();
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    headers: { "Content-Type": "application/json", Origin: BASE },
    data: { identifier, password: "dayarampur123" },
  });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  const state = await context.storageState();
  await context.close();
  return state;
}

const storageState = await signInOnce("01700000001"); // SUPER_ADMIN reaches every route

const findings = [];

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    isMobile: width < 768,
    hasTouch: width < 768,
    storageState,
  });
  const page = await context.newPage();

  for (const route of ROUTES) {
    const url = route === "__PROPERTY__" ? `${BASE}${process.env.PROP_PATH}` : `${BASE}${route}`;
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (!response || response.status() >= 400) continue;
      if (route !== "/login" && new URL(page.url()).pathname === "/login") {
        findings.push({ width, route, error: "redirected to /login — not signed in" });
        continue;
      }
      await page.waitForTimeout(150);

      if (SHOT_ROUTES.has(route)) {
        const name = (route === "__PROPERTY__" ? "property" : route.replace(/\//g, "_") || "_home");
        await page.screenshot({ path: `.audit/shots/${width}${name}.png`, fullPage: true });
      }

      const result = await page.evaluate((vw) => {
        const doc = document.documentElement;
        const overflow = doc.scrollWidth - doc.clientWidth;
        if (overflow <= 0) return { overflow: 0, culprits: [] };

        // Name the elements that actually stick out past the viewport.
        // Anything inside a horizontal scroll container is excluded: it is
        // allowed to be wider than the viewport and cannot widen the document,
        // so listing it only buries the element that really is at fault.
        const inScroller = (el) => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
          }
          return false;
        };

        const culprits = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1 || r.left < -1) {
            if (inScroller(el)) continue;
            const cls = (el.getAttribute("class") || "").slice(0, 90);
            culprits.push({
              tag: el.tagName.toLowerCase(),
              cls,
              right: Math.round(r.right),
              width: Math.round(r.width),
            });
          }
        }
        // Deepest few are the most specific; keep the widest offenders.
        culprits.sort((a, b) => b.right - a.right);
        return { overflow, culprits: culprits.slice(0, 4) };
      }, width);

      if (result.overflow > 0) {
        findings.push({ width, route: route === "__PROPERTY__" ? process.env.PROP_PATH : route, ...result });
      }
    } catch (error) {
      findings.push({ width, route, error: String(error).split("\n")[0].slice(0, 120) });
    }
  }
  await context.close();
}

await browser.close();

if (findings.length === 0) {
  console.log("NO HORIZONTAL OVERFLOW at any tested width.");
} else {
  console.log(`${findings.length} overflow finding(s):\n`);
  for (const f of findings) {
    if (f.error) { console.log(`  ${f.width}px ${f.route} ERROR ${f.error}`); continue; }
    console.log(`  ${f.width}px ${f.route}  +${f.overflow}px`);
    for (const c of f.culprits) console.log(`      <${c.tag} class="${c.cls}"> right=${c.right} w=${c.width}`);
  }
}
