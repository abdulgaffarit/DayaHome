"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import type { PropertyImage } from "@/domain/property";
import { cn } from "@/lib/cn";
import { toBanglaDigits } from "@/lib/bangla";

/**
 * Property gallery.
 *
 * Only the first image is eager; the rest are lazy, which keeps LCP tied to a
 * single request on a listing with fifteen photos. The lightbox is keyboard
 * navigable (arrows, Escape).
 */
export function Gallery({ images, title }: { images: PropertyImage[]; title: string }) {
  const [index, setIndex] = React.useState(0);
  const [lightbox, setLightbox] = React.useState(false);

  const count = images.length;
  const go = React.useCallback(
    (delta: number) => setIndex((current) => (current + delta + count) % count),
    [count],
  );

  React.useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(false);
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, go]);

  if (count === 0) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-[--radius-card] bg-ink-100 text-ink-400">
        <ImageOff className="h-10 w-10" aria-hidden="true" />
        <span className="sr-only">কোনো ছবি নেই</span>
      </div>
    );
  }

  const current = images[index];

  return (
    <>
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-[--radius-card] bg-ink-100">
          <button
            type="button"
            onClick={() => setLightbox(true)}
            className="block w-full"
            aria-label={`${title} — ছবি বড় করে দেখুন`}
          >
            <img
              src={`/api/images/${current.objectKey}`}
              alt={current.altBn ?? `${title} — ছবি ${index + 1}`}
              width={current.width ?? undefined}
              height={current.height ?? undefined}
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "auto"}
              decoding="async"
              className="aspect-[16/10] w-full object-cover"
            />
          </button>

          {count > 1 ? (
            <>
              <GalleryArrow direction="prev" onClick={() => go(-1)} />
              <GalleryArrow direction="next" onClick={() => go(1)} />
              <span className="absolute bottom-3 right-3 rounded-[--radius-pill] bg-ink-900/70 px-3 py-1 text-xs font-medium text-white">
                {toBanglaDigits(index + 1)} / {toBanglaDigits(count)}
              </span>
            </>
          ) : null}
        </div>

        {count > 1 ? (
          <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="ছবির থাম্বনেইল">
            {images.map((image, i) => (
              <li key={image.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`ছবি ${toBanglaDigits(i + 1)}`}
                  aria-current={i === index ? "true" : undefined}
                  className={cn(
                    "h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-colors sm:h-20 sm:w-28",
                    i === index ? "border-brand-700" : "border-transparent hover:border-ink-300",
                  )}
                >
                  <img
                    src={`/api/images/${image.thumbKey ?? image.objectKey}`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} — ছবি`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/95 p-4"
          onClick={() => setLightbox(false)}
        >
          <button
            type="button"
            onClick={() => setLightbox(false)}
            aria-label="বন্ধ করুন"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
          <img
            src={`/api/images/${current.objectKey}`}
            alt={current.altBn ?? `${title} — ছবি ${index + 1}`}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          {count > 1 ? (
            <>
              <GalleryArrow
                direction="prev"
                onClick={(event) => {
                  event.stopPropagation();
                  go(-1);
                }}
                variant="dark"
              />
              <GalleryArrow
                direction="next"
                onClick={(event) => {
                  event.stopPropagation();
                  go(1);
                }}
                variant="dark"
              />
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function GalleryArrow({
  direction,
  onClick,
  variant = "light",
}: {
  direction: "prev" | "next";
  onClick: (event: React.MouseEvent) => void;
  variant?: "light" | "dark";
}) {
  // The UI is Bangla (LTR script, but "next" reads to the right); the chevron
  // directions below match the visual order of the thumbnail strip.
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "আগের ছবি" : "পরের ছবি"}
      className={cn(
        "absolute top-1/2 z-10 -translate-y-1/2 rounded-full p-2 transition-colors",
        direction === "prev" ? "left-3" : "right-3",
        variant === "light"
          ? "bg-white/90 text-ink-700 shadow-sm hover:bg-white"
          : "bg-white/10 text-white hover:bg-white/20",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
