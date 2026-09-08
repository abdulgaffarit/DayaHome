import { cookies } from "next/headers";
import { getDb, siteUrl } from "@/server/cloudflare/env";
import { SESSION_COOKIE, destroySession } from "@/server/auth/session";
import { clearSessionCookie } from "@/server/auth/cookies";
import { isSameOrigin } from "@/server/security/request";
import { guarded, jsonError, jsonOk } from "@/server/http/responses";
import { NO_STORE_HEADERS } from "@/server/security/headers";

/**
 * Logout.
 *
 * Deletes the session row as well as the cookie, so a copied cookie value is
 * dead immediately rather than merely absent from this browser.
 */
export async function POST(request: Request) {
  return guarded(async () => {
    if (!isSameOrigin(request, siteUrl())) return jsonError("CSRF_FAILED");

    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) await destroySession(getDb(), token);
    await clearSessionCookie();

    // A plain HTML form posts here and the browser renders whatever comes
    // back, so JSON would be shown as a page. Answer a navigation with a
    // redirect instead.
    //
    // 303 See Other, and built by hand rather than with next/navigation's
    // `redirect()`: that helper signals by throwing, and a throw from inside
    // `guarded()` used to be caught and returned as SERVER_ERROR — which is
    // the bug this replaces. 303 is also the correct status after a POST, as
    // it tells the browser to follow up with GET.
    if ((request.headers.get("accept") ?? "").includes("text/html")) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/", ...NO_STORE_HEADERS },
      });
    }

    return jsonOk({ ok: true });
  });
}
