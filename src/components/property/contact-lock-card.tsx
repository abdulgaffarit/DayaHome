"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, MapPin, Phone, ShieldCheck, User } from "lucide-react";
import type { ContactResponse } from "@/domain/property";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { toBanglaDigits } from "@/lib/bangla";

/**
 * Locked contact panel.
 *
 * The private values do not exist in this component's props, in the page HTML,
 * or in the RSC payload. They arrive only as the JSON body of an authenticated
 * `GET /api/properties/{id}/contact` call, and only after the server has
 * verified a paid, ACTIVE unlock owned by the signed-in user. Blurring the
 * placeholder below is presentation, not protection — there is nothing behind
 * the blur until the fetch succeeds.
 */
export function ContactLockCard({
  propertyId,
  priceBdt,
  isAuthenticated,
  hasUnlock,
}: {
  propertyId: string;
  priceBdt: number;
  isAuthenticated: boolean;
  /** Server-computed entitlement flag. Reveals nothing private on its own. */
  hasUnlock: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [contact, setContact] = React.useState<Extract<ContactResponse, { locked: false }> | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const reveal = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/contact`, {
        headers: { Accept: "application/json" },
      });
      const data = (await response.json()) as ContactResponse | { error?: { message?: string } };

      if ("locked" in data && data.locked === false) {
        setContact(data);
        return;
      }
      if (response.status === 401) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      toast.show("যোগাযোগের তথ্য দেখতে পেমেন্ট করতে হবে।", "error");
    } catch {
      toast.show("তথ্য আনা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।", "error");
    } finally {
      setLoading(false);
    }
  }, [propertyId, router, toast]);

  // Someone who has already paid should not have to click again.
  React.useEffect(() => {
    if (hasUnlock && !contact) void reveal();
  }, [hasUnlock, contact, reveal]);

  async function startPayment() {
    if (!isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setLoading(true);
    try {
      // Only the property id is sent. The amount is decided server-side; a
      // tampered request body cannot change what is charged.
      const response = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const data = (await response.json()) as {
        redirectUrl?: string;
        alreadyUnlocked?: boolean;
        error?: { message?: string };
      };

      if (data.alreadyUnlocked) {
        setConfirmOpen(false);
        await reveal();
        return;
      }
      if (response.ok && data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      toast.show(data.error?.message ?? "পেমেন্ট শুরু করা যায়নি।", "error");
    } catch {
      toast.show("পেমেন্ট শুরু করা যায়নি। আবার চেষ্টা করুন।", "error");
    } finally {
      setLoading(false);
      setConfirmOpen(false);
    }
  }

  if (contact) return <UnlockedContact contact={contact} />;

  return (
    <>
      <section
        aria-labelledby="contact-lock-heading"
        className="overflow-hidden rounded-[--radius-card] border border-brand-200 bg-white shadow-[--shadow-card]"
      >
        <div className="border-b border-brand-100 bg-surface-mint px-5 py-4">
          <h2
            id="contact-lock-heading"
            className="flex items-center gap-2 text-base font-semibold text-brand-900"
          >
            <Lock className="h-4.5 w-4.5" aria-hidden="true" />
            যোগাযোগের তথ্য
          </h2>
        </div>

        <div className="p-5">
          {/* Decorative placeholder. No real value is present in the DOM. */}
          <div aria-hidden="true" className="space-y-3">
            <LockedRow icon={<Phone className="h-4 w-4" />} placeholder="০১৭XX-XXXXXX" />
            <LockedRow icon={<MapPin className="h-4 w-4" />} placeholder="বাড়ি নং ০০, রোড ০০" />
          </div>

          <p className="mt-5 text-[0.95rem] leading-relaxed text-ink-700">
            মালিকের ফোন নম্বর ও সঠিক লোকেশন দেখতে{" "}
            <strong className="font-semibold text-brand-800">
              ৳{toBanglaDigits(priceBdt)} পেমেন্ট করুন
            </strong>
            ।
          </p>

          <ul className="mt-4 space-y-2 text-sm text-ink-600">
            <Benefit>মালিকের সরাসরি ফোন নম্বর</Benefit>
            <Benefit>বাসার সঠিক ঠিকানা ও ম্যাপ লোকেশন</Benefit>
            <Benefit>একবার পেমেন্ট — এই বিজ্ঞাপনে যতবার খুশি দেখুন</Benefit>
          </ul>

          <Button full size="lg" className="mt-5" onClick={() => setConfirmOpen(true)}>
            ৳{toBanglaDigits(priceBdt)} দিয়ে যোগাযোগের তথ্য দেখুন
          </Button>

          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
            পেমেন্ট সম্পন্ন হয় SSLCOMMERZ-এর নিরাপদ গেটওয়েতে। এই বিজ্ঞাপনের জন্য
            একবারই টাকা লাগবে — পরে আবার এলে নতুন করে টাকা কাটা হবে না।
          </p>
        </div>
      </section>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="পেমেন্ট নিশ্চিত করুন"
        description={`এই বিজ্ঞাপনের যোগাযোগের তথ্য দেখতে ৳${toBanglaDigits(priceBdt)} লাগবে।`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              বাতিল
            </Button>
            <Button onClick={startPayment} loading={loading}>
              পেমেন্টে যান
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-sm text-ink-700">
          <Benefit>মালিকের ফোন নম্বর</Benefit>
          <Benefit>সঠিক ঠিকানা ও লোকেশন</Benefit>
          <Benefit>শুধু এই একটি বিজ্ঞাপনের জন্য প্রযোজ্য</Benefit>
        </ul>
        <p className="mt-4 rounded-[--radius-control] bg-ink-50 p-3 text-xs leading-relaxed text-ink-600">
          পেমেন্ট সফল হলে স্বয়ংক্রিয়ভাবে তথ্য দেখা যাবে। কোনো কারণে টাকা কেটে
          নেওয়ার পরও তথ্য না দেখালে ড্যাশবোর্ডের &ldquo;পেমেন্ট&rdquo; পাতা থেকে
          ট্রানজেকশন আইডি নিয়ে যোগাযোগ করুন।
        </p>
      </Modal>
    </>
  );
}

function LockedRow({ icon, placeholder }: { icon: React.ReactNode; placeholder: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[--radius-control] border border-ink-100 bg-ink-50 px-4 py-3">
      <span className="text-ink-400">{icon}</span>
      <span className="blur-locked select-none font-medium text-ink-500">{placeholder}</span>
    </div>
  );
}

function Benefit({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600"
      />
      <span>{children}</span>
    </li>
  );
}

function UnlockedContact({
  contact,
}: {
  contact: Extract<ContactResponse, { locked: false }>;
}) {
  const mapHref =
    contact.latitude !== null && contact.longitude !== null
      ? `https://www.openstreetmap.org/?mlat=${contact.latitude}&mlon=${contact.longitude}#map=17/${contact.latitude}/${contact.longitude}`
      : null;

  return (
    <section
      aria-labelledby="contact-unlocked-heading"
      className="overflow-hidden rounded-[--radius-card] border border-brand-200 bg-white shadow-[--shadow-card]"
    >
      <div className="border-b border-brand-100 bg-surface-mint px-5 py-4">
        <h2
          id="contact-unlocked-heading"
          className="flex items-center gap-2 text-base font-semibold text-brand-900"
        >
          <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />
          যোগাযোগের তথ্য
        </h2>
      </div>

      <div className="space-y-3 p-5">
        <InfoRow icon={<User className="h-4 w-4" />} label="মালিক">
          {contact.ownerName}
        </InfoRow>

        <InfoRow icon={<Phone className="h-4 w-4" />} label="ফোন">
          <a href={`tel:${contact.phone}`} className="font-semibold text-brand-700 hover:underline">
            {contact.phone}
          </a>
        </InfoRow>

        <InfoRow icon={<MapPin className="h-4 w-4" />} label="সঠিক ঠিকানা">
          {contact.exactLocation}
        </InfoRow>

        <div className="flex flex-wrap gap-2 pt-1">
          <a href={`tel:${contact.phone}`} className="flex-1">
            <Button full>
              <Phone className="h-4 w-4" aria-hidden="true" />
              ফোন করুন
            </Button>
          </a>
          {mapHref ? (
            <a href={mapHref} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button variant="outline" full>
                <MapPin className="h-4 w-4" aria-hidden="true" />
                ম্যাপে দেখুন
              </Button>
            </a>
          ) : null}
        </div>

        <p className="pt-1 text-xs leading-relaxed text-ink-500">
          কথা বলার সময় dayarampur.com-এর কথা বলুন। অগ্রিম টাকা পাঠানোর আগে বাসা
          সরেজমিনে দেখে নিন।
        </p>
      </div>
    </section>
  );
}

function InfoRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[--radius-control] border border-ink-100 bg-white px-4 py-3">
      <span className="mt-0.5 text-brand-600">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-ink-500">{label}</p>
        <div className="text-[0.98rem] text-ink-900">{children}</div>
      </div>
    </div>
  );
}
