"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { CATEGORIES, getCategory, type CategorySlug } from "@/domain/categories";
import { FURNISHED_STATES, PRICE_PERIODS, TENANT_TYPES } from "@/domain/enums";
import {
  propertyStep1Schema,
  propertyStep2Schema,
  propertyStep3Schema,
  propertyStep4Schema,
  propertyStep5Schema,
  propertyStep6Schema,
  propertyStep7Schema,
  propertyStep8Schema,
} from "@/domain/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Turnstile } from "@/components/ui/turnstile";
import { useToast } from "@/components/ui/toast";
import { ImageUploader, type UploadedImage } from "./image-uploader";
import {
  FURNISHED_LABEL_BN,
  TENANT_LABEL_BN,
} from "@/components/property/filter-panel";
import { formatPrice, toBanglaDigits } from "@/lib/bangla";
import { cn } from "@/lib/cn";

const PRICE_PERIOD_LABEL_BN: Record<string, string> = {
  MONTHLY: "মাসিক",
  YEARLY: "বাৎসরিক",
  TOTAL: "সর্বমোট",
  PER_KATHA: "প্রতি কাঠা",
  PER_DECIMAL: "প্রতি শতক",
};

const STEPS = [
  "ক্যাটাগরি",
  "মূল তথ্য",
  "লোকেশন",
  "দাম",
  "বৈশিষ্ট্য",
  "ছবি",
  "বিবরণ",
  "যোগাযোগ",
  "প্রিভিউ",
] as const;

/** The wizard's working state. Everything is a string until submit, matching
 *  what the inputs produce; Zod coerces on both sides. */
interface FormState {
  categorySlug: string;
  title: string;
  propertyType: string;
  areaSlug: string;
  landmark: string;
  generalLocation: string;
  exactAddress: string;
  latitude: string;
  longitude: string;
  price: string;
  pricePeriod: string;
  isNegotiable: boolean;
  bedrooms: string;
  bathrooms: string;
  sizeValue: string;
  sizeUnit: string;
  floor: string;
  totalFloors: string;
  furnished: string;
  tenantType: string;
  availableFrom: string;
  amenitySlugs: string[];
  description: string;
  rules: string;
  ownerName: string;
  phone: string;
}

const INITIAL: FormState = {
  categorySlug: "",
  title: "",
  propertyType: "",
  areaSlug: "",
  landmark: "",
  generalLocation: "",
  exactAddress: "",
  latitude: "",
  longitude: "",
  price: "",
  pricePeriod: "MONTHLY",
  isNegotiable: false,
  bedrooms: "",
  bathrooms: "",
  sizeValue: "",
  sizeUnit: "স্কয়ার ফুট",
  floor: "",
  totalFloors: "",
  furnished: "",
  tenantType: "ANY",
  availableFrom: "",
  amenitySlugs: [],
  description: "",
  rules: "",
  ownerName: "",
  phone: "",
};

/**
 * Ten-step listing wizard.
 *
 * Each step validates with its own Zod schema before advancing, which keeps
 * errors close to where they were made. That is purely a convenience: the
 * server re-validates the whole payload with `createPropertySchema` and decides
 * the status itself, so nothing here is load-bearing for correctness.
 */
export function PostAdWizard({
  areas,
  amenities,
  defaultName,
  defaultPhone,
  turnstileSiteKey,
}: {
  areas: { slug: string; nameBn: string }[];
  amenities: { slug: string; nameBn: string }[];
  defaultName: string;
  defaultPhone: string;
  turnstileSiteKey?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<FormState>({
    ...INITIAL,
    ownerName: defaultName,
    phone: defaultPhone,
  });
  const [images, setImages] = React.useState<UploadedImage[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [token, setToken] = React.useState<string>();
  const [submitting, setSubmitting] = React.useState(false);

  const category = state.categorySlug ? getCategory(state.categorySlug) : undefined;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  function validateStep(index: number): boolean {
    const schemas = [
      propertyStep1Schema,
      propertyStep2Schema,
      propertyStep3Schema,
      propertyStep4Schema,
      propertyStep5Schema,
      propertyStep6Schema,
      propertyStep7Schema,
      propertyStep8Schema,
    ];
    const schema = schemas[index];
    if (!schema) return true;

    const payload = index === 5 ? { imageIds: images.map((i) => i.id) } : state;
    const result = schema.safeParse(payload);
    if (result.success) {
      setErrors({});
      return true;
    }
    const fieldErrors: Record<string, string> = {};
    for (const [key, messages] of Object.entries(result.error.flatten().fieldErrors)) {
      if (messages?.length) fieldErrors[key] = messages[0];
    }
    setErrors(fieldErrors);
    return false;
  }

  function next() {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function back() {
    setErrors({});
    setStep((current) => Math.max(current - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    // Re-run every step before sending, so a user who jumped back and edited an
    // earlier step cannot submit a half-valid listing.
    for (let i = 0; i < 8; i++) {
      if (!validateStep(i)) {
        setStep(i);
        toast.show("কিছু তথ্য অসম্পূর্ণ। আবার দেখুন।", "error");
        return;
      }
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...state,
          imageIds: images.map((image) => image.id),
          turnstileToken: token,
          submit: true,
        }),
      });
      const body = (await response.json()) as {
        slug?: string;
        error?: { message?: string; fields?: Record<string, string> };
      };

      if (!response.ok) {
        setErrors(body.error?.fields ?? {});
        toast.show(body.error?.message ?? "বিজ্ঞাপন জমা দেওয়া যায়নি।", "error");
        return;
      }

      toast.show("বিজ্ঞাপন জমা হয়েছে! অনুমোদনের পর এটি সাইটে দেখা যাবে।", "success");
      router.push("/dashboard/properties");
      router.refresh();
    } catch {
      toast.show("বিজ্ঞাপন জমা দেওয়া যায়নি। আবার চেষ্টা করুন।", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <StepIndicator current={step} />

      <div className="mt-6 rounded-[--radius-card] border border-ink-100 bg-white p-5 shadow-[--shadow-card] sm:p-7">
        <h2 className="mb-5 text-lg font-semibold text-ink-900">
          ধাপ {toBanglaDigits(step + 1)}: {STEPS[step]}
        </h2>

        {/* -------------------- 1. Category -------------------- */}
        {step === 0 ? (
          <fieldset>
            <legend className="mb-3 text-sm text-ink-600">
              আপনি কী ধরনের বিজ্ঞাপন দিতে চান?
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {CATEGORIES.map((entry) => (
                <label
                  key={entry.slug}
                  className={cn(
                    "cursor-pointer rounded-[--radius-control] border-2 p-4 text-center transition-colors",
                    state.categorySlug === entry.slug
                      ? "border-brand-700 bg-surface-mint"
                      : "border-ink-200 hover:border-brand-300",
                  )}
                >
                  <input
                    type="radio"
                    name="categorySlug"
                    value={entry.slug}
                    checked={state.categorySlug === entry.slug}
                    onChange={() => {
                      set("categorySlug", entry.slug as CategorySlug);
                      set("pricePeriod", entry.defaultPricePeriod);
                      set("sizeUnit", entry.landAreaUnits ? "শতক" : "স্কয়ার ফুট");
                    }}
                    className="sr-only"
                  />
                  <span className="font-medium text-ink-900">{entry.nameBn}</span>
                </label>
              ))}
            </div>
            {errors.categorySlug ? (
              <p role="alert" className="mt-2 text-sm text-danger-700">
                {errors.categorySlug}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {/* -------------------- 2. Basics -------------------- */}
        {step === 1 ? (
          <div className="space-y-4">
            <Field
              label="বিজ্ঞাপনের শিরোনাম"
              htmlFor="w-title"
              required
              error={errors.title}
              hint="যেমন: কলেজ রোডে ২ রুমের ফ্যামিলি বাসা ভাড়া"
            >
              <Input
                id="w-title"
                value={state.title}
                onChange={(event) => set("title", event.target.value)}
                maxLength={120}
              />
            </Field>
            <Field
              label="সম্পত্তির ধরন"
              htmlFor="w-type"
              error={errors.propertyType}
              hint="ঐচ্ছিক — যেমন: ফ্ল্যাট, টিনশেড, দোতলা বাড়ি"
            >
              <Input
                id="w-type"
                value={state.propertyType}
                onChange={(event) => set("propertyType", event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {/* -------------------- 3. Location -------------------- */}
        {step === 2 ? (
          <div className="space-y-4">
            <Field label="এলাকা" htmlFor="w-area" required error={errors.areaSlug}>
              <Select
                id="w-area"
                value={state.areaSlug}
                onChange={(event) => set("areaSlug", event.target.value)}
              >
                <option value="">এলাকা বেছে নিন</option>
                {areas.map((area) => (
                  <option key={area.slug} value={area.slug}>
                    {area.nameBn}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="আশপাশের পরিচিত জায়গা"
              htmlFor="w-landmark"
              error={errors.landmark}
              hint="যেমন: দয়ারামপুর কলেজের পাশে। এটি সবাই দেখতে পাবে।"
            >
              <Input
                id="w-landmark"
                value={state.landmark}
                onChange={(event) => set("landmark", event.target.value)}
              />
            </Field>

            <Field
              label="সাধারণ লোকেশন"
              htmlFor="w-general"
              error={errors.generalLocation}
              hint="আনুমানিক অবস্থান — সবাই দেখতে পাবে।"
            >
              <Input
                id="w-general"
                value={state.generalLocation}
                onChange={(event) => set("generalLocation", event.target.value)}
              />
            </Field>

            <div className="rounded-[--radius-card] border border-brand-100 bg-surface-mint p-4">
              <p className="mb-3 text-sm font-medium text-brand-900">
                নিচের তথ্যগুলো গোপন থাকবে
              </p>
              <p className="mb-4 text-sm leading-relaxed text-ink-600">
                সঠিক ঠিকানা ও ম্যাপ লোকেশন কেউ বিনামূল্যে দেখতে পাবে না। যে
                ব্যক্তি ৳৫০ পেমেন্ট করবে শুধু সে-ই এগুলো দেখতে পাবে।
              </p>

              <Field label="সঠিক ঠিকানা" htmlFor="w-exact" required error={errors.exactAddress}>
                <Textarea
                  id="w-exact"
                  value={state.exactAddress}
                  onChange={(event) => set("exactAddress", event.target.value)}
                  className="min-h-24"
                  placeholder="বাড়ি নং, রোড, মহল্লা…"
                />
              </Field>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <Field label="অক্ষাংশ (latitude)" htmlFor="w-lat" error={errors.latitude}>
                  <Input
                    id="w-lat"
                    inputMode="decimal"
                    value={state.latitude}
                    onChange={(event) => set("latitude", event.target.value)}
                    placeholder="24.2069"
                  />
                </Field>
                <Field label="দ্রাঘিমাংশ (longitude)" htmlFor="w-lng" error={errors.longitude}>
                  <Input
                    id="w-lng"
                    inputMode="decimal"
                    value={state.longitude}
                    onChange={(event) => set("longitude", event.target.value)}
                    placeholder="89.0631"
                  />
                </Field>
              </div>
            </div>
          </div>
        ) : null}

        {/* -------------------- 4. Price -------------------- */}
        {step === 3 ? (
          <div className="space-y-4">
            <Field label="দাম / ভাড়া (৳)" htmlFor="w-price" required error={errors.price}>
              <Input
                id="w-price"
                type="number"
                inputMode="numeric"
                min={1}
                value={state.price}
                onChange={(event) => set("price", event.target.value)}
              />
            </Field>
            <Field label="দামের ধরন" htmlFor="w-period" required error={errors.pricePeriod}>
              <Select
                id="w-period"
                value={state.pricePeriod}
                onChange={(event) => set("pricePeriod", event.target.value)}
              >
                {PRICE_PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {PRICE_PERIOD_LABEL_BN[period]}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox
              id="w-negotiable"
              label="দাম আলোচনাসাপেক্ষ"
              checked={state.isNegotiable}
              onChange={(event) => set("isNegotiable", event.target.checked)}
            />
          </div>
        ) : null}

        {/* -------------------- 5. Features -------------------- */}
        {step === 4 ? (
          <div className="space-y-4">
            {category?.hasRooms !== false ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="বেডরুম" htmlFor="w-bed" error={errors.bedrooms}>
                  <Input
                    id="w-bed"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={state.bedrooms}
                    onChange={(event) => set("bedrooms", event.target.value)}
                  />
                </Field>
                <Field label="বাথরুম" htmlFor="w-bath" error={errors.bathrooms}>
                  <Input
                    id="w-bath"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={state.bathrooms}
                    onChange={(event) => set("bathrooms", event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="আয়তন" htmlFor="w-size" error={errors.sizeValue}>
                <Input
                  id="w-size"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={state.sizeValue}
                  onChange={(event) => set("sizeValue", event.target.value)}
                />
              </Field>
              <Field label="একক" htmlFor="w-unit" error={errors.sizeUnit}>
                <Input
                  id="w-unit"
                  value={state.sizeUnit}
                  onChange={(event) => set("sizeUnit", event.target.value)}
                />
              </Field>
            </div>

            {category?.hasRooms !== false ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="কত তলায়" htmlFor="w-floor" error={errors.floor}>
                  <Input
                    id="w-floor"
                    type="number"
                    inputMode="numeric"
                    value={state.floor}
                    onChange={(event) => set("floor", event.target.value)}
                  />
                </Field>
                <Field label="মোট তলা" htmlFor="w-floors" error={errors.totalFloors}>
                  <Input
                    id="w-floors"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={state.totalFloors}
                    onChange={(event) => set("totalFloors", event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="সজ্জা" htmlFor="w-furnished" error={errors.furnished}>
                <Select
                  id="w-furnished"
                  value={state.furnished}
                  onChange={(event) => set("furnished", event.target.value)}
                >
                  <option value="">প্রযোজ্য নয়</option>
                  {FURNISHED_STATES.map((value) => (
                    <option key={value} value={value}>
                      {FURNISHED_LABEL_BN[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="কারা থাকতে পারবেন" htmlFor="w-tenant" error={errors.tenantType}>
                <Select
                  id="w-tenant"
                  value={state.tenantType}
                  onChange={(event) => set("tenantType", event.target.value)}
                >
                  {TENANT_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {TENANT_LABEL_BN[value]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="কবে থেকে খালি" htmlFor="w-available" error={errors.availableFrom}>
              <Input
                id="w-available"
                type="date"
                value={state.availableFrom}
                onChange={(event) => set("availableFrom", event.target.value)}
              />
            </Field>

            <fieldset>
              <legend className="mb-2 block text-sm font-medium text-ink-700">
                সুযোগ-সুবিধা
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {amenities.map((amenity) => (
                  <Checkbox
                    key={amenity.slug}
                    id={`amn-${amenity.slug}`}
                    label={amenity.nameBn}
                    checked={state.amenitySlugs.includes(amenity.slug)}
                    onChange={(event) =>
                      set(
                        "amenitySlugs",
                        event.target.checked
                          ? [...state.amenitySlugs, amenity.slug]
                          : state.amenitySlugs.filter((slug) => slug !== amenity.slug),
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}

        {/* -------------------- 6. Photos -------------------- */}
        {step === 5 ? (
          <div>
            <ImageUploader images={images} onChange={setImages} />
            {errors.imageIds ? (
              <p role="alert" className="mt-2 text-sm text-danger-700">
                {errors.imageIds}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* -------------------- 7. Description -------------------- */}
        {step === 6 ? (
          <div className="space-y-4">
            <Field
              label="বিস্তারিত বিবরণ"
              htmlFor="w-description"
              required
              error={errors.description}
              hint="বাসার অবস্থা, আশপাশের সুবিধা, কী কী আছে — খোলামেলা লিখুন।"
            >
              <Textarea
                id="w-description"
                value={state.description}
                onChange={(event) => set("description", event.target.value)}
                className="min-h-40"
                maxLength={5000}
              />
            </Field>
            <Field
              label="নিয়মাবলী"
              htmlFor="w-rules"
              error={errors.rules}
              hint="ঐচ্ছিক — যেমন: অগ্রিম ২ মাস, পোষা প্রাণী নিষেধ"
            >
              <Textarea
                id="w-rules"
                value={state.rules}
                onChange={(event) => set("rules", event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {/* -------------------- 8. Contact -------------------- */}
        {step === 7 ? (
          <div className="space-y-4">
            <div className="rounded-[--radius-control] bg-surface-mint p-4 text-sm leading-relaxed text-brand-900">
              এই তথ্য গোপন থাকবে। শুধু যারা ৳৫০ পেমেন্ট করবেন তারাই আপনার নম্বর
              দেখতে পাবেন — ফলে অপ্রয়োজনীয় ফোন কল অনেক কমে যায়।
            </div>
            <Field label="আপনার নাম" htmlFor="w-owner" required error={errors.ownerName}>
              <Input
                id="w-owner"
                value={state.ownerName}
                onChange={(event) => set("ownerName", event.target.value)}
              />
            </Field>
            <Field
              label="যোগাযোগের মোবাইল নম্বর"
              htmlFor="w-phone"
              required
              error={errors.phone}
            >
              <Input
                id="w-phone"
                type="tel"
                inputMode="tel"
                value={state.phone}
                onChange={(event) => set("phone", event.target.value)}
                placeholder="০১৭xxxxxxxx"
              />
            </Field>
          </div>
        ) : null}

        {/* -------------------- 9-10. Preview & submit -------------------- */}
        {step === 8 ? (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-[--radius-card] border border-ink-100">
              {images[0] ? (
                <img src={images[0].url} alt="" className="aspect-[16/10] w-full object-cover" />
              ) : null}
              <div className="p-4">
                <h3 className="text-lg font-semibold text-ink-900">{state.title}</h3>
                <p className="mt-1 text-sm text-ink-500">
                  {category?.nameBn} ·{" "}
                  {areas.find((a) => a.slug === state.areaSlug)?.nameBn ?? ""}
                </p>
                <p className="mt-2 text-xl font-bold text-brand-700">
                  {state.price
                    ? formatPrice(Number(state.price), state.pricePeriod)
                    : "—"}
                </p>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-700">
                  {state.description}
                </p>
              </div>
            </div>

            <div className="rounded-[--radius-control] bg-ink-50 p-4 text-sm leading-relaxed text-ink-600">
              জমা দেওয়ার পর বিজ্ঞাপনটি অ্যাডমিনের অনুমোদনের অপেক্ষায় থাকবে।
              অনুমোদন হলে আপনি জানতে পারবেন এবং তখন এটি সাইটে দেখা যাবে।
            </div>

            <Turnstile siteKey={turnstileSiteKey} onToken={setToken} />
          </div>
        ) : null}

        {/* -------------------- Navigation -------------------- */}
        <div className="mt-7 flex items-center justify-between gap-3 border-t border-ink-100 pt-5">
          <Button type="button" variant="outline" onClick={back} disabled={step === 0}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
            পেছনে
          </Button>

          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>
              পরবর্তী
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="button" onClick={submit} loading={submitting} size="lg">
              <Check className="h-4 w-4" aria-hidden="true" />
              বিজ্ঞাপন জমা দিন
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <div>
      <ol className="flex flex-wrap gap-1.5" aria-label="ধাপসমূহ">
        {STEPS.map((label, index) => (
          <li key={label} className="flex-1">
            <div
              aria-current={index === current ? "step" : undefined}
              className={cn(
                "rounded-[--radius-pill] border px-2 py-1 text-center text-[0.7rem] font-medium transition-colors",
                index < current && "border-brand-200 bg-brand-100 text-brand-900",
                index === current && "border-brand-700 bg-brand-700 text-white",
                index > current && "border-ink-200 bg-white text-ink-400",
              )}
            >
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{toBanglaDigits(index + 1)}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm text-ink-500">
        ধাপ {toBanglaDigits(current + 1)} / {toBanglaDigits(STEPS.length)}
      </p>
    </div>
  );
}
