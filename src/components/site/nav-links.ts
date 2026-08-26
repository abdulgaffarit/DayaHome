/** Primary navigation, shared by the desktop header and the mobile drawer. */
export interface NavLink {
  href: string;
  label: string;
}

export const PRIMARY_NAV: readonly NavLink[] = [
  { href: "/", label: "হোম" },
  { href: "/basha-vhara", label: "বাসা ভাড়া" },
  { href: "/basha-bikri", label: "বাসা বিক্রি" },
  { href: "/dokaan-vhara", label: "দোকান ভাড়া" },
  { href: "/office-vhara", label: "অফিস ভাড়া" },
  { href: "/jomi-bikri", label: "জমি" },
  { href: "/mess", label: "সার্ভিস" },
  { href: "/contact", label: "যোগাযোগ" },
];

/** Everything, for the footer sitemap and the mobile drawer's full list. */
export const ALL_CATEGORY_LINKS: readonly NavLink[] = [
  { href: "/basha-vhara", label: "বাসা ভাড়া" },
  { href: "/basha-bikri", label: "বাসা বিক্রি" },
  { href: "/dokaan-vhara", label: "দোকান ভাড়া" },
  { href: "/office-vhara", label: "অফিস ভাড়া" },
  { href: "/godown-vhara", label: "গুদাম ভাড়া" },
  { href: "/jomi-bikri", label: "জমি বিক্রি" },
  { href: "/jomi-vhara", label: "জমি ভাড়া" },
  { href: "/mess", label: "মেস" },
  { href: "/sublet", label: "সাবলেট" },
];
