"use client";

import * as React from "react";
import { ImagePlus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { toBanglaDigits } from "@/lib/bangla";

export interface UploadedImage {
  id: string;
  url: string;
}

const MAX_IMAGES = 15;

/**
 * Photo step.
 *
 * Uploads happen immediately, one request per file, and the server returns an
 * image id. The wizard then submits only those ids — raw bytes never travel
 * with the listing payload, which keeps the create request small and lets a
 * half-finished draft keep its photos.
 */
export function ImageUploader({
  images,
  onChange,
}: {
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
}) {
  const toast = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      toast.show(`সর্বোচ্চ ${toBanglaDigits(MAX_IMAGES)} টি ছবি দেওয়া যাবে।`, "error");
      return;
    }

    setUploading(true);
    const accepted: UploadedImage[] = [];

    for (const file of Array.from(files).slice(0, room)) {
      const body = new FormData();
      body.append("file", file);
      try {
        const response = await fetch("/api/uploads/images", { method: "POST", body });
        const data = (await response.json()) as {
          id?: string;
          url?: string;
          error?: { message?: string };
        };
        if (!response.ok || !data.id || !data.url) {
          toast.show(data.error?.message ?? `"${file.name}" আপলোড করা যায়নি।`, "error");
          continue;
        }
        accepted.push({ id: data.id, url: data.url });
      } catch {
        toast.show(`"${file.name}" আপলোড করা যায়নি।`, "error");
      }
    }

    if (accepted.length > 0) onChange([...images, ...accepted]);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(id: string) {
    onChange(images.filter((image) => image.id !== id));
  }

  /** The first image is the card thumbnail, so "make primary" is a reorder. */
  function makePrimary(id: string) {
    const target = images.find((image) => image.id === id);
    if (!target) return;
    onChange([target, ...images.filter((image) => image.id !== id)]);
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void handleFiles(event.dataTransfer.files);
        }}
        className="rounded-[--radius-card] border-2 border-dashed border-ink-200 bg-ink-50/60 p-8 text-center"
      >
        <ImagePlus className="mx-auto h-8 w-8 text-ink-400" aria-hidden="true" />
        <p className="mt-3 font-medium text-ink-800">ছবি টেনে এনে ছাড়ুন, অথবা</p>
        <input
          ref={inputRef}
          id="property-images"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          loading={uploading}
          onClick={() => inputRef.current?.click()}
        >
          ছবি বেছে নিন
        </Button>
        <p className="mt-3 text-sm text-ink-500">
          JPG, PNG বা WebP · সর্বোচ্চ ৫ এমবি · সর্বোচ্চ {toBanglaDigits(MAX_IMAGES)} টি ছবি
        </p>
      </div>

      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image, index) => (
            <li
              key={image.id}
              className={cn(
                "group relative overflow-hidden rounded-[--radius-control] border-2",
                index === 0 ? "border-brand-700" : "border-ink-100",
              )}
            >
              <img src={image.url} alt="" className="aspect-[4/3] w-full object-cover" />

              {index === 0 ? (
                <span className="absolute left-2 top-2 rounded-[--radius-pill] bg-brand-700 px-2 py-0.5 text-xs font-medium text-white">
                  প্রধান ছবি
                </span>
              ) : null}

              <div className="absolute right-2 top-2 flex gap-1">
                {index !== 0 ? (
                  <button
                    type="button"
                    onClick={() => makePrimary(image.id)}
                    aria-label="প্রধান ছবি করুন"
                    className="rounded-full bg-white/90 p-1.5 text-ink-600 hover:text-gold-700"
                  >
                    <Star className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => remove(image.id)}
                  aria-label="ছবিটি সরান"
                  className="rounded-full bg-white/90 p-1.5 text-ink-600 hover:text-danger-500"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
