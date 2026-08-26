import { toBanglaDigits } from "@/lib/bangla";

/**
 * Inline SVG charts.
 *
 * Deliberately hand-rolled rather than pulling a charting library into the
 * bundle: these are small trend indicators, and a 100 KB dependency for four
 * sparklines is a bad trade on a mobile-first site.
 */
export function LineChart({
  title,
  points,
  formatValue = (v: number) => toBanglaDigits(v),
}: {
  title: string;
  points: { day: string; value: number }[];
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const width = 320;
  const height = 90;
  const step = points.length > 1 ? width / (points.length - 1) : width;

  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = height - (point.value / max) * (height - 8) - 4;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const total = points.reduce((sum, point) => sum + point.value, 0);

  return (
    <figure className="rounded-[--radius-card] border border-ink-100 bg-white p-5">
      <figcaption className="mb-1 text-sm font-medium text-ink-600">{title}</figcaption>
      <p className="mb-3 text-2xl font-bold text-ink-900">{formatValue(total)}</p>

      {points.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-400">এখনো কোনো তথ্য নেই</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-24 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}: ${formatValue(total)}`}
        >
          <path
            d={`${path} L${width},${height} L0,${height} Z`}
            fill="var(--color-brand-100)"
            opacity="0.6"
          />
          <path d={path} fill="none" stroke="var(--color-brand-700)" strokeWidth="2" />
        </svg>
      )}
    </figure>
  );
}

export function BarList({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <figure className="rounded-[--radius-card] border border-ink-100 bg-white p-5">
      <figcaption className="mb-4 text-sm font-medium text-ink-600">{title}</figcaption>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-ink-700">{item.label}</span>
              <span className="font-medium text-ink-900">{toBanglaDigits(item.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
