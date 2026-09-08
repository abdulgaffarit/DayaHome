/**
 * The route-handler wrapper.
 *
 * `guarded()` is a catch-all, and Next signals `redirect()` and `notFound()`
 * by throwing rather than returning. A catch-all that swallows those turns a
 * working redirect into a 500 — which is what happened to logout: a form POST
 * rendered the SERVER_ERROR JSON at /api/auth/logout instead of going home.
 */
import { describe, expect, it } from "vitest";
import { guarded, jsonOk } from "@/server/http/responses";

/** The shape next/navigation throws. The digest carries the destination. */
function redirectSignal(to = "/"): Error & { digest: string } {
  return Object.assign(new Error("NEXT_REDIRECT"), {
    digest: `NEXT_REDIRECT;replace;${to};303;`,
  });
}

describe("guarded()", () => {
  it("passes a normal response straight through", async () => {
    const response = await guarded(async () => jsonOk({ ok: true }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("CRITICAL: re-throws a redirect signal instead of returning a 500", async () => {
    const signal = redirectSignal("/");

    // It must come back out untouched, so Next can act on it.
    await expect(guarded(async () => { throw signal; })).rejects.toBe(signal);
  });

  it("CRITICAL: re-throws a notFound signal too", async () => {
    const signal = Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });

    await expect(guarded(async () => { throw signal; })).rejects.toBe(signal);
  });

  it("still converts a real error into a clean 500", async () => {
    const response = await guarded(async () => {
      throw new Error("database is on fire");
    });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("SERVER_ERROR");
    // The internal detail must not reach the client.
    expect(JSON.stringify(body)).not.toContain("database is on fire");
  });

  it("a thrown non-Error is still a 500, not a leak", async () => {
    for (const thrown of ["a string", 42, null, undefined, { notADigest: true }]) {
      const response = await guarded(async () => {
        throw thrown;
      });
      expect(response.status).toBe(500);
    }
  });

  it("an object whose digest is not a string is treated as an error", async () => {
    // Guards the narrowing: only a string digest is a framework signal.
    const response = await guarded(async () => {
      throw { digest: 12345 };
    });

    expect(response.status).toBe(500);
  });
});

describe("the logout route contract", () => {
  it("CRITICAL: answers a browser navigation with a redirect, never JSON", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "src/app/api/auth/logout/route.ts"),
      "utf8",
    );

    // A form POST is answered with 303 See Other, which makes the browser
    // follow up with GET.
    expect(source).toMatch(/status:\s*303/);
    expect(source).toContain('Location: "/"');

    // POST only — a GET logout endpoint would be CSRF-able by any link or
    // <img> on another site.
    expect(source).toMatch(/export async function POST\(/);
    expect(source).not.toMatch(/export async function GET\(/);

    // Same-origin is still enforced, and the session row still destroyed.
    expect(source).toContain("isSameOrigin");
    expect(source).toContain("destroySession");
    expect(source).toContain("clearSessionCookie");
  });

  it("CRITICAL: every logout control in the UI submits POST", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const controls = [
      "src/components/site/mobile-menu.tsx",
      "src/components/dashboard/sidebar.tsx",
      "src/components/admin/sidebar.tsx",
    ];

    for (const file of controls) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      // Matches the form regardless of what other attributes it carries.
      const form = source.match(/<form[^>]*action="\/api\/auth\/logout"[^>]*>/);
      expect(form, `${file} should have a logout form`).not.toBeNull();
      expect(form![0], `${file} must submit POST`).toMatch(/method="post"/);
      // A plain link would issue GET and hit no handler at all.
      expect(source, `${file} must not link to logout`).not.toMatch(
        /href=["'][^"']*api\/auth\/logout/,
      );
    }
  });
});
