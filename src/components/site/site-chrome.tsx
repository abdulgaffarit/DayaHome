"use client";

import { usePathname } from "next/navigation";

/**
 * Hides the public site chrome inside the admin panel.
 *
 * The root layout wraps every route, so `/admin` would otherwise inherit the
 * marketing header and footer. Admin has its own sidebar and topbar, and the
 * public nav is noise there.
 *
 * Children are Server Components passed through as a slot, so wrapping them in
 * this client component does not pull the header's data fetching to the client.
 */
export function HideOnAdmin({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;
  return <>{children}</>;
}
