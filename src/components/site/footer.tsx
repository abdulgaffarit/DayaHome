import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { Logo } from "./logo";
import { ALL_CATEGORY_LINKS } from "./nav-links";

const CURRENT_YEAR = new Date().getFullYear();

export function Footer() {
  return (
    <footer className="mt-16 border-t border-ink-100 bg-surface-soft">
      <div className="container-page grid gap-10 py-12 md:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-1">
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-600">
            দয়ারামপুরের বাসা, দোকান, অফিস ও জমির বিজ্ঞাপন এক জায়গায়। স্থানীয়
            মালিক ও ভাড়াটিয়াদের জন্য তৈরি।
          </p>
        </div>

        <FooterColumn title="ক্যাটাগরি">
          {ALL_CATEGORY_LINKS.map((link) => (
            <FooterLink key={link.href} href={link.href}>
              {link.label}
            </FooterLink>
          ))}
        </FooterColumn>

        <FooterColumn title="দরকারি লিংক">
          <FooterLink href="/post-ad">বিজ্ঞাপন দিন</FooterLink>
          <FooterLink href="/search">খুঁজুন</FooterLink>
          <FooterLink href="/favorites">পছন্দের তালিকা</FooterLink>
          <FooterLink href="/dashboard">ড্যাশবোর্ড</FooterLink>
          <FooterLink href="/how-it-works">কীভাবে কাজ করে</FooterLink>
          <FooterLink href="/terms">শর্তাবলী</FooterLink>
          <FooterLink href="/privacy">গোপনীয়তা নীতি</FooterLink>
        </FooterColumn>

        <FooterColumn title="যোগাযোগ">
          <li className="flex items-start gap-2.5 text-sm text-ink-600">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
            দয়ারামপুর, বাগাতিপাড়া, নাটোর
          </li>
          <li className="flex items-start gap-2.5 text-sm text-ink-600">
            <Phone className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
            <a href="tel:+8801700000000" className="hover:text-brand-800">
              ০১৭০০-০০০০০০
            </a>
          </li>
          <li className="flex items-start gap-2.5 text-sm text-ink-600">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
            <a href="mailto:support@dayarampur.com" className="hover:text-brand-800">
              support@dayarampur.com
            </a>
          </li>
        </FooterColumn>
      </div>

      <div className="border-t border-ink-200/70">
        <div className="container-page flex flex-col items-center justify-between gap-2 py-5 text-sm text-ink-500 sm:flex-row">
          <p>© {CURRENT_YEAR} dayarampur.com — সর্বস্বত্ব সংরক্ষিত।</p>
          <p>দয়ারামপুরের নিজের ঠিকানা</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-900">{title}</h2>
      <ul className="space-y-2.5">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-sm text-ink-600 transition-colors hover:text-brand-800">
        {children}
      </Link>
    </li>
  );
}
