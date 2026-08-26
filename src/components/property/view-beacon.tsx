"use client";

import * as React from "react";

/**
 * Records one view for this listing.
 *
 * Done from the client rather than during render so that prefetches, crawlers
 * and RSC re-renders do not inflate the count. The server still de-duplicates
 * by visitor fingerprint and day, so this is a hint, not a trusted number.
 */
export function ViewBeacon({ propertyId }: { propertyId: string }) {
  React.useEffect(() => {
    const controller = new AbortController();
    // A short delay filters out immediate bounces and back-button flashes.
    const timer = setTimeout(() => {
      void fetch(`/api/properties/${encodeURIComponent(propertyId)}/view`, {
        method: "POST",
        signal: controller.signal,
        keepalive: true,
      }).catch(() => {});
    }, 1500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [propertyId]);

  return null;
}
