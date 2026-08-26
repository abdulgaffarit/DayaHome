import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, siteUrl } from "@/server/cloudflare/env";
import { SESSION_COOKIE, destroySession } from "@/server/auth/session";
import { clearSessionCookie } from "@/server/auth/cookies";
import { isSameOrigin } from "@/server/security/request";
import { guarded, jsonError, jsonOk } from "@/server/http/responses";

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

    // The mobile drawer posts a plain HTML form; send it back to the homepage
    // instead of returning JSON it cannot render.
    if ((request.headers.get("accept") ?? "").includes("text/html")) redirect("/");
    return jsonOk({ ok: true });
  });
}
