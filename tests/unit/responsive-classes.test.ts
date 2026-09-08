import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Responsive visibility depends on `hidden` actually winning.
 *
 * `buttonVariants` used to concatenate rather than merge, so a caller asking
 * for `hidden sm:inline-flex` kept the base `inline-flex` as well. Tailwind
 * emits `inline-flex` after `hidden`, so the element stayed visible at every
 * width — which is how the site header's desktop-only buttons rendered at
 * 320px and pushed every page 179px wider than the viewport.
 */
describe("display-class merging", () => {
  it("lets a caller's `hidden` override the button base `inline-flex`", () => {
    const classes = buttonVariants({ size: "sm", className: "hidden sm:inline-flex" }).split(/\s+/);

    expect(classes).toContain("hidden");
    expect(classes).toContain("sm:inline-flex");
    expect(classes).not.toContain("inline-flex");
  });

  it("keeps the base display when the caller asks for nothing", () => {
    expect(buttonVariants({ size: "sm" }).split(/\s+/)).toContain("inline-flex");
  });

  it("still applies variant and size classes through the merge", () => {
    const classes = buttonVariants({ variant: "outline", size: "sm" }).split(/\s+/);
    expect(classes).toContain("h-9");
    expect(classes).toContain("border-ink-200");
  });

  it("resolves the same conflict for any other caller of cn", () => {
    expect(cn("inline-flex", "hidden lg:inline-flex").split(/\s+/)).not.toContain("inline-flex");
  });
});
