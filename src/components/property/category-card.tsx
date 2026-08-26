import Link from "next/link";
import {
  Briefcase,
  Building2,
  DoorOpen,
  Home,
  LandPlot,
  Store,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { CategoryDef } from "@/domain/categories";
import { toBanglaDigits } from "@/lib/bangla";

const ICONS: Record<CategoryDef["icon"], LucideIcon> = {
  home: Home,
  "building-2": Building2,
  store: Store,
  briefcase: Briefcase,
  warehouse: Warehouse,
  "land-plot": LandPlot,
  users: Users,
  "door-open": DoorOpen,
};

export function CategoryCard({
  category,
  count,
}: {
  category: CategoryDef;
  count?: number;
}) {
  const Icon = ICONS[category.icon];
  return (
    <Link
      href={`/${category.slug}`}
      className="group flex flex-col items-center gap-3 rounded-[--radius-card] border border-ink-100 bg-white p-5 text-center shadow-[--shadow-card] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[--shadow-card-hover]"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-mint text-brand-700 transition-colors group-hover:bg-brand-700 group-hover:text-white">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <span className="text-[0.95rem] font-semibold leading-tight text-ink-900">
        {category.nameBn}
      </span>
      <span className="text-xs text-ink-500">
        {count !== undefined ? `${toBanglaDigits(count)} টি বিজ্ঞাপন` : "দেখুন"}
      </span>
    </Link>
  );
}
