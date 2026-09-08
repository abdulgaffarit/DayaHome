"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { BannerUploader, type UploadedBanner } from "./banner-uploader";
import { formatTaka, toBanglaDigits } from "@/lib/bangla";
import { cn } from "@/lib/cn";
import { AD_TARGET_DEVICES } from "@/domain/advertising";

export interface ZoneChoice {
  id: string;
  slug: string;
  name_bn: string;
  description_bn: string | null;
  desktop_size: string;
  mobile_size: string | null;
  base_price_bdt: number;
}

export interface PackageChoice {
  id: string;
  slug: string;
  name_bn: string;
  description_bn: string | null;
  zone_id: string | null;
  duration_days: number;
  price_bdt: number;
  max_creatives: number;
}

export interface GatewayChoice {
  id: string;
  labelBn: string;
  manual: boolean;
}

const STEPS = [
  "ব্যবসার তথ্য",
  "জোন",
  "প্যাকেজ",
  "ব্যানার",
  "লিংক ও টার্গেট",
  "প্রিভিউ",
  "পেমেন্ট",
] as const;

/** Shape of every JSON reply from the advertise endpoints. */
interface ApiReply {
  ok?: true;
  campaignId?: string;
  manual?: boolean;
  redirectUrl?: string;
  instructionsBn?: string;
  reference?: string;
  accountNumber?: string;
  error?: { message?: string; fields?: Record<string, string> };
}

const DEVICE_LABEL_BN: Record<string, string> = {
  ALL: "সব ডিভাইস",
  DESKTOP: "শুধু ডেস্কটপ",
  MOBILE: "শুধু মোবাইল",
};

interface FormState {
  businessName: string;
  contactPerson: string;
  businessPhone: string;
  businessEmail: string;
  websiteUrl: string;
  zoneId: string;
  packageId: string;
  title: string;
  destinationUrl: string;
  requestedStartAt: string;
  targetDevice: string;
}

/**
 * The /advertise flow.
 *
 * Order matters and is not cosmetic. The advertiser profile and the DRAFT
 * campaign are created BEFORE the banner step, because a banner has to belong
 * to a campaign that already exists — the upload endpoint checks ownership
 * against it. Payment is last, and paying does not publish anything: the
 * campaign lands in the review queue.
 */
export function AdvertiseWizard({
  zones,
  packages,
  gateways,
  isSignedIn,
  existingAdvertiser,
}: {
  zones: ZoneChoice[];
  packages: PackageChoice[];
  gateways: GatewayChoice[];
  isSignedIn: boolean;
  existingAdvertiser: { businessName: string; contactPerson: string; businessPhone: string } | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [campaignId, setCampaignId] = React.useState<string>();
  const [banners, setBanners] = React.useState<UploadedBanner[]>([]);
  const [manualInstructions, setManualInstructions] = React.useState<{
    instructionsBn: string;
    reference: string;
    accountNumber?: string;
  }>();

  const [state, setState] = React.useState<FormState>({
    businessName: existingAdvertiser?.businessName ?? "",
    contactPerson: existingAdvertiser?.contactPerson ?? "",
    businessPhone: existingAdvertiser?.businessPhone ?? "",
    businessEmail: "",
    websiteUrl: "",
    zoneId: zones[0]?.id ?? "",
    packageId: "",
    title: "",
    destinationUrl: "",
    requestedStartAt: "",
    targetDevice: "ALL",
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  const zone = zones.find((z) => z.id === state.zoneId);
  // A package pinned to another zone is not on offer here.
  const availablePackages = packages.filter((p) => !p.zone_id || p.zone_id === state.zoneId);
  const chosenPackage = availablePackages.find((p) => p.id === state.packageId);

  if (!isSignedIn) {
    return (
      <div className="rounded-[--radius-card] border border-ink-200 bg-white p-6 text-center">
        <p className="text-ink-700">বিজ্ঞাপন দিতে প্রথমে লগইন করুন।</p>
        <div className="mt-4 flex justify-center gap-3">
          <Button onClick={() => router.push("/login?next=/advertise")}>লগইন</Button>
          <Button variant="secondary" onClick={() => router.push("/register?next=/advertise")}>
            রেজিস্টার
          </Button>
        </div>
      </div>
    );
  }

  /** Creates (or reuses) the advertiser profile, then the DRAFT campaign. */
  async function createDraft(): Promise<boolean> {
    setErrors({});

    const advertiserResponse = await fetch("/api/advertise/advertiser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessName: state.businessName,
        contactPerson: state.contactPerson,
        businessPhone: state.businessPhone,
        businessEmail: state.businessEmail || undefined,
        websiteUrl: state.websiteUrl || undefined,
      }),
    });
    const advertiserData = (await advertiserResponse.json()) as ApiReply;
    if (!advertiserResponse.ok) {
      setErrors(advertiserData.error?.fields ?? {});
      toast.show(advertiserData.error?.message ?? "ব্যবসার তথ্য সংরক্ষণ করা যায়নি।", "error");
      return false;
    }

    const campaignResponse = await fetch("/api/advertise/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zoneId: state.zoneId,
        packageId: state.packageId,
        title: state.title,
        destinationUrl: state.destinationUrl,
        requestedStartAt: state.requestedStartAt || undefined,
        targetDevice: state.targetDevice,
      }),
    });
    const campaignData = (await campaignResponse.json()) as ApiReply;
    if (!campaignResponse.ok) {
      setErrors(campaignData.error?.fields ?? {});
      toast.show(campaignData.error?.message ?? "ক্যাম্পেইন তৈরি করা যায়নি।", "error");
      return false;
    }

    setCampaignId(campaignData.campaignId!);
    return true;
  }

  async function pay(gatewayId?: string) {
    if (!campaignId) return;
    setBusy(true);
    try {
      const query = gatewayId ? `?gateway=${encodeURIComponent(gatewayId)}` : "";
      const response = await fetch(`/api/advertise/campaigns/${campaignId}/pay${query}`, {
        method: "POST",
      });
      const data = (await response.json()) as ApiReply;

      if (!response.ok) {
        toast.show(data.error?.message ?? "পেমেন্ট শুরু করা যায়নি।", "error");
        return;
      }
      if (data.manual) {
        setManualInstructions({
          instructionsBn: data.instructionsBn ?? "",
          reference: data.reference ?? "",
          accountNumber: data.accountNumber,
        });
        return;
      }
      window.location.href = data.redirectUrl!;
    } finally {
      setBusy(false);
    }
  }

  /** Per-step gate. Steps that create server state do so here. */
  async function next() {
    setErrors({});

    if (step === 0) {
      const missing: Record<string, string> = {};
      if (state.businessName.trim().length < 2) missing.businessName = "ব্যবসার নাম দিন।";
      if (state.contactPerson.trim().length < 2) missing.contactPerson = "যোগাযোগকারীর নাম দিন।";
      if (!/^01[3-9]\d{8}$/.test(state.businessPhone.replace(/[\s-]/g, ""))) {
        missing.businessPhone = "সঠিক মোবাইল নম্বর দিন।";
      }
      if (Object.keys(missing).length) return setErrors(missing);
    }

    if (step === 1 && !state.zoneId) {
      return setErrors({ zoneId: "একটি জোন বেছে নিন।" });
    }

    if (step === 2) {
      if (!state.packageId) return setErrors({ packageId: "একটি প্যাকেজ বেছে নিন।" });
      if (state.title.trim().length < 3) return setErrors({ title: "বিজ্ঞাপনের নাম দিন।" });
      if (!/^https?:\/\/.+\..+/.test(state.destinationUrl.trim())) {
        return setErrors({ destinationUrl: "সম্পূর্ণ লিংক দিন (https:// দিয়ে শুরু)।" });
      }

      // The campaign must exist before a banner can be attached to it.
      setBusy(true);
      const created = await createDraft().finally(() => setBusy(false));
      if (!created) return;
    }

    if (step === 3 && banners.length === 0) {
      return setErrors({ banner: "অন্তত একটি ব্যানার আপলোড করুন।" });
    }

    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  return (
    <div className="rounded-[--radius-card] border border-ink-200 bg-white">
      <StepIndicator current={step} />

      <div className="p-5 sm:p-6">
        {step === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ব্যবসার নাম" htmlFor="businessName" required error={errors.businessName}>
              <Input
                id="businessName"
                value={state.businessName}
                onChange={(e) => set("businessName", e.target.value)}
                placeholder="যেমন: করিম ইলেকট্রনিক্স"
              />
            </Field>
            <Field label="যোগাযোগকারীর নাম" htmlFor="contactPerson" required error={errors.contactPerson}>
              <Input
                id="contactPerson"
                value={state.contactPerson}
                onChange={(e) => set("contactPerson", e.target.value)}
              />
            </Field>
            <Field label="মোবাইল নম্বর" htmlFor="businessPhone" required error={errors.businessPhone}>
              <Input
                id="businessPhone"
                inputMode="numeric"
                value={state.businessPhone}
                onChange={(e) => set("businessPhone", e.target.value)}
                placeholder="01XXXXXXXXX"
              />
            </Field>
            <Field label="ইমেইল (ঐচ্ছিক)" htmlFor="businessEmail" error={errors.businessEmail}>
              <Input
                id="businessEmail"
                type="email"
                value={state.businessEmail}
                onChange={(e) => set("businessEmail", e.target.value)}
              />
            </Field>
            <Field
              label="ওয়েবসাইট (ঐচ্ছিক)"
              htmlFor="websiteUrl"
              error={errors.websiteUrl}
              className="sm:col-span-2"
            >
              <Input
                id="websiteUrl"
                value={state.websiteUrl}
                onChange={(e) => set("websiteUrl", e.target.value)}
                placeholder="https://example.com"
              />
            </Field>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {zones.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => set("zoneId", option.id)}
                aria-pressed={state.zoneId === option.id}
                className={cn(
                  "rounded-[--radius-card] border p-4 text-right transition-colors",
                  state.zoneId === option.id
                    ? "border-brand-600 bg-surface-mint"
                    : "border-ink-200 hover:border-ink-300",
                )}
              >
                <span className="block font-semibold text-ink-900">{option.name_bn}</span>
                {option.description_bn ? (
                  <span className="mt-1 block text-sm text-ink-600">{option.description_bn}</span>
                ) : null}
                <span className="mt-2 block text-xs text-ink-500">
                  ডেস্কটপ {option.desktop_size}
                  {option.mobile_size ? ` · মোবাইল ${option.mobile_size}` : ""}
                </span>
              </button>
            ))}
            {errors.zoneId ? <p className="text-sm text-danger-700">{errors.zoneId}</p> : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {availablePackages.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => set("packageId", option.id)}
                  aria-pressed={state.packageId === option.id}
                  className={cn(
                    "rounded-[--radius-card] border p-4 text-right transition-colors",
                    state.packageId === option.id
                      ? "border-brand-600 bg-surface-mint"
                      : "border-ink-200 hover:border-ink-300",
                  )}
                >
                  <span className="block font-semibold text-ink-900">{option.name_bn}</span>
                  <span className="mt-1 block text-lg font-bold text-brand-700">
                    {formatTaka(option.price_bdt)}
                  </span>
                  <span className="mt-1 block text-sm text-ink-600">
                    {toBanglaDigits(option.duration_days)} দিন · সর্বোচ্চ{" "}
                    {toBanglaDigits(option.max_creatives)}টি ব্যানার
                  </span>
                </button>
              ))}
            </div>
            {errors.packageId ? <p className="text-sm text-danger-700">{errors.packageId}</p> : null}

            <Field label="বিজ্ঞাপনের নাম" htmlFor="title" required error={errors.title}>
              <Input
                id="title"
                value={state.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="যেমন: ঈদ অফার ২০২৬"
              />
            </Field>
            <Field
              label="যেখানে নিয়ে যাবে (লিংক)"
              htmlFor="destinationUrl"
              required
              error={errors.destinationUrl}
              hint="শুধু http বা https লিংক ব্যবহার করা যাবে।"
            >
              <Input
                id="destinationUrl"
                value={state.destinationUrl}
                onChange={(e) => set("destinationUrl", e.target.value)}
                placeholder="https://example.com/offer"
              />
            </Field>
          </div>
        ) : null}

        {step === 3 && campaignId ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <BannerUploader
              campaignId={campaignId}
              variant="DESKTOP"
              label="ডেস্কটপ ব্যানার"
              recommendedSize={zone?.desktop_size ?? null}
              banner={banners.find((b) => b.variant === "DESKTOP")}
              onUploaded={(b) => setBanners((list) => [...list.filter((x) => x.variant !== "DESKTOP"), b])}
              onRemoved={() => setBanners((list) => list.filter((b) => b.variant !== "DESKTOP"))}
            />
            <BannerUploader
              campaignId={campaignId}
              variant="MOBILE"
              label="মোবাইল ব্যানার (ঐচ্ছিক)"
              recommendedSize={zone?.mobile_size ?? null}
              banner={banners.find((b) => b.variant === "MOBILE")}
              onUploaded={(b) => setBanners((list) => [...list.filter((x) => x.variant !== "MOBILE"), b])}
              onRemoved={() => setBanners((list) => list.filter((b) => b.variant !== "MOBILE"))}
            />
            {errors.banner ? (
              <p className="text-sm text-danger-700 sm:col-span-2">{errors.banner}</p>
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="কবে থেকে শুরু (ঐচ্ছিক)" htmlFor="requestedStartAt">
              <Input
                id="requestedStartAt"
                type="date"
                value={state.requestedStartAt}
                onChange={(e) => set("requestedStartAt", e.target.value)}
              />
            </Field>
            <Field label="কোন ডিভাইসে দেখাবে" htmlFor="targetDevice">
              <Select
                id="targetDevice"
                value={state.targetDevice}
                onChange={(e) => set("targetDevice", e.target.value)}
              >
                {AD_TARGET_DEVICES.map((device) => (
                  <option key={device} value={device}>
                    {DEVICE_LABEL_BN[device]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-600">
              জমা দেওয়ার আগে দেখে নিন। পেমেন্টের পর বিজ্ঞাপনটি সরাসরি সাইটে যাবে না — আমাদের
              টিম যাচাই করে অনুমোদন দেওয়ার পরেই দেখা যাবে।
            </p>

            {banners.map((banner) => (
              <div key={banner.id} className="rounded-[--radius-card] border border-ink-200 p-3">
                <p className="mb-2 text-xs font-medium text-ink-500">
                  {banner.variant === "DESKTOP" ? "ডেস্কটপ" : "মোবাইল"}
                </p>
                { }
                <img src={banner.url} alt="ব্যানার প্রিভিউ" className="w-full rounded" />
              </div>
            ))}

            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="ব্যবসা" value={state.businessName} />
              <Row label="জোন" value={zone?.name_bn ?? "—"} />
              <Row label="প্যাকেজ" value={chosenPackage?.name_bn ?? "—"} />
              <Row
                label="মেয়াদ"
                value={
                  chosenPackage ? `${toBanglaDigits(chosenPackage.duration_days)} দিন` : "—"
                }
              />
              <Row label="ডিভাইস" value={DEVICE_LABEL_BN[state.targetDevice]} />
              <Row
                label="মোট দাম"
                value={chosenPackage ? formatTaka(chosenPackage.price_bdt) : "—"}
              />
            </dl>

            <p className="flex items-center gap-1.5 break-all text-sm text-ink-600">
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              {state.destinationUrl}
            </p>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="space-y-4">
            {manualInstructions ? (
              <div className="rounded-[--radius-card] border border-brand-200 bg-surface-mint p-4">
                <p className="font-medium text-ink-900">{manualInstructions.instructionsBn}</p>
                {manualInstructions.accountNumber ? (
                  <p className="mt-2 text-sm text-ink-700">
                    নম্বর: <strong>{manualInstructions.accountNumber}</strong>
                  </p>
                ) : null}
                <p className="mt-2 text-sm text-ink-700">
                  রেফারেন্স: <strong className="font-mono">{manualInstructions.reference}</strong>
                </p>
                <p className="mt-3 text-sm text-ink-600">
                  টাকা পাঠানোর পর অ্যাডমিন যাচাই করে ক্যাম্পেইনটি পর্যালোচনায় পাঠাবেন।
                </p>
                <Button className="mt-4" onClick={() => router.push("/advertiser")}>
                  আমার ক্যাম্পেইন দেখুন
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-ink-600">পেমেন্টের মাধ্যম বেছে নিন।</p>
                {gateways.length === 0 ? (
                  <p className="rounded-[--radius-card] border border-warning-200 bg-warning-50 p-4 text-sm text-ink-700">
                    এই মুহূর্তে কোনো পেমেন্ট মাধ্যম চালু নেই। পরে আবার চেষ্টা করুন।
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {gateways.map((gateway) => (
                      <Button key={gateway.id} disabled={busy} onClick={() => void pay(gateway.id)}>
                        {gateway.labelBn}
                      </Button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-ink-100 p-4">
        <Button
          type="button"
          variant="ghost"
          disabled={step === 0 || busy}
          onClick={() => setStep((c) => Math.max(c - 1, 0))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          পেছনে
        </Button>

        {step < STEPS.length - 1 ? (
          <Button type="button" disabled={busy} onClick={() => void next()}>
            পরবর্তী
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : (
          <span className="text-sm text-ink-500">
            ধাপ {toBanglaDigits(step + 1)} / {toBanglaDigits(STEPS.length)}
          </span>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-ink-100 py-1.5">
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap gap-2 border-b border-ink-100 p-4 text-xs">
      {STEPS.map((label, index) => (
        <li
          key={label}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1",
            index === current
              ? "bg-brand-600 text-white"
              : index < current
                ? "bg-surface-mint text-brand-800"
                : "text-ink-400",
          )}
        >
          {index < current ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
          {label}
        </li>
      ))}
    </ol>
  );
}
