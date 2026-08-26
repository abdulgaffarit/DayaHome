import Link from "next/link";
import { Logo } from "@/components/site/logo";

/** Centred card used by the login and registration pages. */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100vh-16rem)] items-center justify-center bg-surface-soft px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo showTagline={false} />
        </div>
        <div className="rounded-[--radius-card] border border-ink-100 bg-white p-6 shadow-[--shadow-card] sm:p-8">
          <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
          <p className="mb-6 mt-1.5 text-sm text-ink-500">{description}</p>
          {children}
        </div>
        <p className="mt-6 text-center text-sm text-ink-500">
          <Link href="/" className="hover:text-brand-700">
            ← হোমপেজে ফিরে যান
          </Link>
        </p>
      </div>
    </div>
  );
}
