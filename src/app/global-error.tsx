"use client";

/**
 * Last-resort boundary: catches failures in the root layout itself, so it must
 * render its own <html> and cannot rely on any app styling.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="bn">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: "2rem",
          textAlign: "center",
          color: "#232928",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
            সাময়িক সমস্যা হয়েছে
          </h1>
          <p style={{ color: "#6b7674" }}>
            একটু পরে আবার চেষ্টা করুন। সমস্যা থাকলে support@dayarampur.com-এ জানান।
          </p>
          {error.digest ? (
            <p style={{ marginTop: "1rem", fontSize: "0.8rem", color: "#98a3a0" }}>
              রেফারেন্স: {error.digest}
            </p>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
              global-error replaces the root layout, so the router (and
              therefore next/link) is not available here. */}
          <a
            href="/"
            style={{
              display: "inline-block",
              marginTop: "1.5rem",
              padding: "0.65rem 1.25rem",
              borderRadius: "0.75rem",
              background: "#0b6b3a",
              color: "#fff",
              textDecoration: "none",
            }}
          >
            হোমপেজে যান
          </a>
        </div>
      </body>
    </html>
  );
}
