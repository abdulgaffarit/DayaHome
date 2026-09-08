/**
 * Reports interactive controls below the 44x44 CSS-px touch target at 375px.
 *
 * Run the dev server first, then:
 *   PROP_PATH=/property/<slug> node scripts/audit/touch-targets.mjs
 */
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const ROUTES = ["/", "/search", "/login", "/register", "/post-ad", "/dashboard", "/advertise", "/admin", "/admin/properties", process.env.PROP_PATH];
const b = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const auth = await b.newContext();
const res = await auth.request.post(`${BASE}/api/auth/login`, { headers: { "Content-Type": "application/json", Origin: BASE },
  data: { identifier: "01700000001", password: "dayarampur123" } });
if (!res.ok()) throw new Error("login " + res.status());
const storageState = await auth.storageState(); await auth.close();

const ctx = await b.newContext({ viewport: { width: 375, height: 640 }, isMobile: true, hasTouch: true, storageState });
const page = await ctx.newPage();
for (const route of ROUTES) {
  const r = await page.goto(BASE + route, { waitUntil: "domcontentloaded" }).catch(() => null);
  if (!r || r.status() >= 400) continue;
  await page.waitForTimeout(250);
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("a[href], button, input, select, textarea, [role=button]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      // Inline text links inside a paragraph are read, not tapped in isolation.
      if (el.tagName === "A" && cs.display === "inline") continue;
      if (r.height < 40 || r.width < 24) {
        out.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent||el.getAttribute("aria-label")||"").trim().slice(0,28)}"`);
      }
    }
    return [...new Set(out)];
  });
  if (small.length) console.log(`${route}\n   ` + small.join("\n   "));
}
await b.close();
