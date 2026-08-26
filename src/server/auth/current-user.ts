import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasAtLeastRole, type Role } from "@/domain/enums";
import { getDb } from "@/server/cloudflare/env";
import { SESSION_COOKIE, resolveSession, type AuthUser, type SessionContext } from "./session";

/**
 * Current session for this request.
 *
 * Wrapped in React's `cache` so a page, its layout and its child components
 * share a single database round-trip.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSession(getDb(), token);
});

export async function getCurrentUser(): Promise<AuthUser | null> {
  return (await getSessionContext())?.user ?? null;
}

/**
 * Server-component guard: sends anonymous visitors to /login with a `next`
 * parameter so they return to where they were going.
 */
export async function requireUser(returnTo?: string): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }
  return user;
}

/**
 * Role guard. A user who is signed in but under-privileged gets 403 rather than
 * a login redirect — bouncing them to /login would be a confusing loop.
 */
export async function requireRole(role: Role, returnTo?: string): Promise<AuthUser> {
  const user = await requireUser(returnTo);
  if (!hasAtLeastRole(user.role, role)) redirect("/403");
  return user;
}

export async function requireAdmin(returnTo?: string): Promise<AuthUser> {
  return requireRole("ADMIN", returnTo);
}

export async function requireSuperAdmin(returnTo?: string): Promise<AuthUser> {
  return requireRole("SUPER_ADMIN", returnTo);
}
