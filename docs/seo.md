# SEO

The site is SEO-first: everything indexable is server-rendered, and filtered
views live at real, shareable URLs rather than in client state.

## Indexable surface

| URL | Indexed | Notes |
|---|---|---|
| `/` | ✅ | `WebSite` + `SearchAction` JSON-LD |
| `/basha-vhara/` and the other eight categories | ✅ | Bangla title and description per category |
| `/property/[slug]/` | ✅ | `RealEstateListing` JSON-LD |
| `/how-it-works`, `/contact`, `/terms`, `/privacy` | ✅ | |
| `/search` | ❌ noindex, follow | Unbounded filter space; links still crawled |
| `/favorites` | ❌ noindex | Per-user |
| `/login`, `/register`, `/post-ad` | ❌ noindex | |
| `/dashboard/*`, `/admin/*`, `/payment/*` | ❌ noindex + disallowed | |

## Metadata

`generateMetadata` runs on the server for every listing and produces a unique
title, meta description, canonical URL, Open Graph tags and Twitter card tags.

The description is assembled from category, area and price plus the start of the
listing body, truncated to 160 characters.

**All of it is built from `PublicProperty`**, so a private field cannot reach a
meta tag even by accident — the type has no such field.

## Structured data

`propertyJsonLd()` emits a `RealEstateListing` with an `Offer`. It carries
`addressLocality` (the neighbourhood name) and `addressRegion`, and deliberately
**omits `telephone`, `streetAddress` and `geo`** — publishing those would give
away the paid contact details in the page source. A test asserts they are
absent.

Breadcrumbs are emitted as a separate `BreadcrumbList`.

## URLs

```
/basha-vhara/
/basha-vhara/?area=college-road
/property/room-basha-vhara-dayarampur-1042/
```

Slugs are Bangla titles transliterated to ASCII plus the public reference, which
guarantees uniqueness and keeps links copy-pasteable rather than
percent-encoded.

Query parameters are only appended when they differ from the default —
`?page=1`, `?sort=newest` and `?view=grid` are omitted — so the canonical URL of
an unfiltered page is clean.

## Sitemap and robots

`app/sitemap.ts` generates the homepage, the nine category pages, every
category × area combination (the local long tail) and every `APPROVED` listing,
with `lastModified` from `properties.updated_at`.

`app/robots.ts` disallows `/admin`, `/dashboard`, `/api/`, the auth pages,
`/post-ad`, `/payment/` and `/favorites`, and points at the sitemap.

## Local keyword targeting

Category definitions in `src/domain/categories.ts` carry natural Bangla titles
and descriptions: *দয়ারামপুরে বাসা ভাড়া*, *দয়ারামপুরে দোকান ভাড়া*,
*দয়ারামপুরে জমি বিক্রি*, and so on. Each appears once in the H1 and once in the
meta description. Area filters produce genuinely useful landing pages
(*কলেজ রোডে বাসা ভাড়া*) rather than doorway pages.

No keyword stuffing: the phrase appears where a reader would expect it and
nowhere else.

## Performance

- Server-rendered HTML; the only client JavaScript on a listing page is the
  gallery, the favourite button and the contact panel.
- The first gallery image is eager with `fetchPriority="high"`; everything else
  is lazy.
- `width`/`height` on images prevents layout shift.
- Immutable cache headers on R2 objects; `s-maxage` on public JSON.
- Charts are hand-rolled inline SVG rather than a charting library.
- The Bangla font loads with `display: swap`.

## Accessibility

Semantic landmarks, a skip link, labelled form controls with
`aria-invalid`/`aria-describedby`, `aria-live` regions for toasts and result
counts, a native `<dialog>` for modals (focus trapping and Escape for free),
visible focus rings throughout, and a `prefers-reduced-motion` block.
