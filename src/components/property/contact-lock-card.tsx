"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, MapPin, Phone, ShieldCheck, User } from "lucide-react";
import type { ContactResponse } from "@/domain/property";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { toBanglaDigits } from "@/lib/bangla";
import { safeNextPath } from "@/lib/next-path";

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
/**
 * Where to come back to after signing in: this property, with the intent to
 * unlock preserved.
 *
 * Built from `window.location.pathname` rather than anything in the URL, and
 * put through `safeNextPath` before it is handed to the auth pages, so the
 * value that ends up in `?next=` is always a same-origin path this app owns.
 */
function unlockReturnPath(): string {
  if (typeof window === "undefined") return "/";
  return safeNextPath(`${window.location.pathname}?unlock=1`, "/");
}

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
  const [manual, setManual] = React.useState<{
    instructionsBn: string;
    reference: string;
    accountNumber?: string;
  } | null>(null);

  // A ref, not the `loading` state: state updates are async, so two clicks in
  // the same tick would both see `loading === false` and both POST.
  const inFlight = React.useRef(false);

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
        router.push(`/register?next=${encodeURIComponent(unlockReturnPath())}`);
        return;
      }
      toast.show("যোগাযোগের তথ্য দেখতে পেমেন্ট করতে হবে।", "error");
    } catch {
      toast.show("তথ্য আনা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।", "error");
    } finally {
      setLoading(false);
    }
  }, [propertyId, router, toast]);

  // Someone who has already paid should not have to click again. Guarded by a
  // ref so a re-render mid-fetch cannot start a second request.
  const autoRevealed = React.useRef(false);
  React.useEffect(() => {
    if (!hasUnlock || autoRevealed.current) return;
    autoRevealed.current = true;
    void reveal();
  }, [hasUnlock, reveal]);


  const startPayment = React.useCallback(async () => {
    if (!isAuthenticated) {
      // Most people reaching this button are buying for the first time, so
      // registration is the right default. The register page carries a login
      // link that preserves `next`, which is how someone who already has an
      // account gets there without losing the property or the intent.
      router.push(`/register?next=${encodeURIComponent(unlockReturnPath())}`);
      return;
    }

    // Guards a double-click: the second call returns before it can POST.
    if (inFlight.current) return;
    inFlight.current = true;

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
        manual?: boolean;
        instructionsBn?: string;
        reference?: string;
        accountNumber?: string;
        error?: { message?: string };
      };

      if (data.alreadyUnlocked) {
        setConfirmOpen(false);
        await reveal();
        return;
      }

      // A gateway that settles out of band returns instructions instead of a
      // checkout URL. Treating that as a failure was the production bug: the
      // payment row had already been created, so every retry left another
      // PENDING row behind while the payer was told it had not worked.
      if (response.ok && data.manual) {
        setManual({
          instructionsBn: data.instructionsBn ?? "",
          reference: data.reference ?? "",
          accountNumber: data.accountNumber,
        });
        setConfirmOpen(false);
        return;
      }

      if (response.ok && data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }

      toast.show(
        data.error?.message ??
          "পেমেন্ট শুরু করা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন বা আমাদের সাথে যোগাযোগ করুন।",
        "error",
      );
    } catch {
      toast.show("পেমেন্ট শুরু করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।", "error");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [isAuthenticated, propertyId, reveal, router, toast]);

  /**
   * Resume checkout after signing in.
   *
   * The auth pages send the visitor back to `?unlock=1`, which is the whole
   * point of carrying `next` through registration: they land where they left
   * off with the purchase already in progress rather than on a page they have
   * to find their way back from.
   *
   * The flag is stripped from the address bar first, so a refresh — or a
   * shared link — does not re-open checkout unasked.
   */
  const autoStarted = React.useRef(false);
  React.useEffect(() => {
    if (autoStarted.current || hasUnlock || !isAuthenticated) return;
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("unlock") !== "1") return;

    autoStarted.current = true;
    window.history.replaceState(null, "", window.location.pathname);

    // Scheduled rather than called inline: `startPayment` sets state, and
    // doing that synchronously inside an effect cascades an extra render.
    const timer = window.setTimeout(() => void startPayment(), 0);
    return () => window.clearTimeout(timer);
  }, [hasUnlock, isAuthenticated, startPayment]);

  if (contact) return <UnlockedContact contact={contact} />;
  if (manual) return <ManualInstructions manual={manual} priceBdt={priceBdt} />;

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

          <Button
            full
            size="lg"
            className="mt-5"
            disabled={loading}
            onClick={() => setConfirmOpen(true)}
          >
            ৳{toBanglaDigits(priceBdt)} দিয়ে যোগাযোগের তথ্য দেখুন
          </Button>

          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
            পেমেন্ট নিরাপদভাবে সম্পন্ন হয়। এই বিজ্ঞাপনের জন্য একবারই টাকা লাগবে —
            পরে আবার এলে নতুন করে টাকা কাটা হবে না।
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
            <Button variant="outline" disabled={loading} onClick={() => setConfirmOpen(false)}>
              বাতিল
            </Button>
            <Button onClick={() => void startPayment()} loading={loading} disabled={loading}>
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

/**
 * Shown when the active gateway settles out of band.
 *
 * This is a real state, not an error: the payment row exists and is PENDING,
 * the payer has a reference to quote, and an administrator confirms it. Saying
 * "পেমেন্ট শুরু করা যায়নি" here — which is what used to happen — told the payer
 * the opposite of the truth and invited them to click again.
 */
function ManualInstructions({
  manual,
  priceBdt,
}: {
  manual: { instructionsBn: string; reference: string; accountNumber?: string };
  priceBdt: number;
}) {
  return (
    <section
      aria-labelledby="manual-payment-heading"
      className="overflow-hidden rounded-[--radius-card] border border-brand-200 bg-white shadow-[--shadow-card]"
    >
      <div className="border-b border-brand-100 bg-surface-mint px-5 py-4">
        <h2
          id="manual-payment-heading"
          className="flex items-center gap-2 text-base font-semibold text-brand-900"
        >
          <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />
          পেমেন্টের নির্দেশনা
        </h2>
      </div>

      <div className="space-y-3 p-5 text-[0.95rem] leading-relaxed text-ink-700">
        <p>{manual.instructionsBn}</p>

        {manual.accountNumber ? (
          <p className="rounded-[--radius-control] border border-ink-100 bg-ink-50 px-4 py-3">
            নম্বর:{" "}
            <strong className="font-semibold text-ink-900">{manual.accountNumber}</strong>
          </p>
        ) : null}

        <p className="rounded-[--radius-control] border border-ink-100 bg-ink-50 px-4 py-3">
          পরিমাণ: <strong className="font-semibold text-ink-900">৳{toBanglaDigits(priceBdt)}</strong>
        </p>

        <p className="rounded-[--radius-control] border border-brand-100 bg-surface-mint px-4 py-3">
          রেফারেন্স:{" "}
          <strong className="break-all font-mono font-semibold text-brand-900">
            {manual.reference}
          </strong>
        </p>

        <p className="text-sm text-ink-600">
          টাকা পাঠানোর সময় রেফারেন্সটি উল্লেখ করুন। যাচাই সম্পন্ন হলে এই বিজ্ঞাপনের
          যোগাযোগের তথ্য আপনার অ্যাকাউন্টে খুলে দেওয়া হবে। একই বিজ্ঞাপনের জন্য আবার
          টাকা পাঠানোর দরকার নেই।
        </p>
      </div>
    </section>
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
