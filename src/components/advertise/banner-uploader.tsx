"use client";

import * as React from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toBanglaDigits } from "@/lib/bangla";

export interface UploadedBanner {
  id: string;
  url: string;
  variant: "DESKTOP" | "MOBILE";
  width: number | null;
  height: number | null;
}

/**
 * Banner upload for one variant.
 *
 * The browser check here is a courtesy that saves a round trip; it is not the
 * security boundary. The server re-derives the real format from the file's
 * magic bytes and ignores whatever the browser claimed.
 */
export function BannerUploader({
  campaignId,
  variant,
  label,
  recommendedSize,
  banner,
  onUploaded,
  onRemoved,
}: {
  campaignId: string;
  variant: "DESKTOP" | "MOBILE";
  label: string;
  recommendedSize: string | null;
  banner?: UploadedBanner;
  onUploaded: (banner: UploadedBanner) => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [alt, setAlt] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(undefined);
    if (alt.trim().length < 2) {
      setError("আগে ব্যানারের বিকল্প টেক্সট লিখুন।");
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("campaignId", campaignId);
      body.append("variant", variant);
      body.append("altBn", alt.trim());

      const response = await fetch("/api/advertise/creatives", { method: "POST", body });
      const data = (await response.json()) as
        | { ok: true; id: string; url: string; width: number | null; height: number | null }
        | { error: { message: string } };

      if (!response.ok || !("ok" in data)) {
        setError("error" in data ? data.error.message : "আপলোড ব্যর্থ হয়েছে।");
        return;
      }
      onUploaded({ id: data.id, url: data.url, variant, width: data.width, height: data.height });
    } catch {
      setError("আপলোড ব্যর্থ হয়েছে। ইন্টারনেট সংযোগ দেখুন।");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (banner) {
    return (
      <div className="rounded-[--radius-card] border border-ink-200 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-ink-700">{label}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onRemoved}>
            <X className="h-4 w-4" aria-hidden="true" />
            সরান
          </Button>
        </div>
        { }
        <img
          src={banner.url}
          alt="আপলোড করা ব্যানার"
          className="w-full rounded-[--radius-control] border border-ink-100 bg-ink-50 object-contain"
        />
        {banner.width && banner.height ? (
          <p className="mt-2 text-xs text-ink-500">
            {toBanglaDigits(banner.width)} × {toBanglaDigits(banner.height)} পিক্সেল
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-[--radius-card] border border-dashed border-ink-300 p-4">
      <p className="text-sm font-medium text-ink-700">{label}</p>
      {recommendedSize ? (
        <p className="mt-0.5 text-xs text-ink-500">প্রস্তাবিত মাপ: {recommendedSize} পিক্সেল</p>
      ) : null}

      <label className="mt-3 block text-sm text-ink-600" htmlFor={`alt-${variant}`}>
        ব্যানারের বিকল্প টেক্সট (alt)
      </label>
      <input
        id={`alt-${variant}`}
        value={alt}
        onChange={(event) => setAlt(event.target.value)}
        placeholder="যেমন: করিম ইলেকট্রনিক্স — ঈদ অফার"
        className="mt-1 w-full rounded-[--radius-control] border border-ink-200 px-3 py-2 text-sm"
        maxLength={200}
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      <Button
        type="button"
        variant="secondary"
        className="mt-3"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
        )}
        ব্যানার আপলোড করুন
      </Button>

      <p className="mt-2 text-xs text-ink-500">JPG, PNG বা WebP — সর্বোচ্চ ২ এমবি।</p>
      {error ? <p className="mt-2 text-sm text-danger-700">{error}</p> : null}
    </div>
  );
}
