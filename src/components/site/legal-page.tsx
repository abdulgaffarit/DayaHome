export function LegalPage({
  title,
  updatedAt,
  intro,
  children,
}: {
  title: string;
  updatedAt: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="container-page max-w-3xl py-12">
      <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm text-ink-400">সর্বশেষ হালনাগাদ: {updatedAt}</p>
      <p className="mt-4 leading-relaxed text-ink-600">{intro}</p>
      <div className="mt-8 space-y-7">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
      <p className="mt-2 leading-relaxed text-ink-700">{children}</p>
    </section>
  );
}
