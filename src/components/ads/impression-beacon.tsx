"use client";

import * as React from "react";

/**
 * Reports one impression, once the advert has actually been on screen.
 *
 * Fired from an IntersectionObserver rather than on render, so a banner far
 * below the fold that nobody scrolled to is not billed as a view. The server
 * deduplicates per visitor per day regardless; this only makes the count
 * honest at the moment it is taken.
 *
 * Failure is silent by design — a blocked beacon must not surface an error on
 * a page the visitor came for something else entirely.
 */
export function AdImpressionBeacon({
  campaignId,
  creativeId,
}: {
  campaignId: string;
  creativeId: string;
}) {
  const anchor = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const element = anchor.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    let sent = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (sent || !entries.some((entry) => entry.isIntersecting)) return;
        sent = true;
        observer.disconnect();

        void fetch("/api/ads/impression", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId, creativeId, pagePath: window.location.pathname }),
          keepalive: true,
        }).catch(() => {});
      },
      { threshold: 0.5 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [campaignId, creativeId]);

  return <span ref={anchor} aria-hidden="true" />;
}
