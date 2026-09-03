import type { Metadata } from "next";
import { CheckCircle2, KeyRound, XCircle } from "lucide-react";
import { getDb, getEnv } from "@/server/cloudflare/env";
import { requireSuperAdmin } from "@/server/auth/current-user";
import { listGatewayStatuses } from "@/server/payments/registry";
import { GatewayControls } from "@/components/admin/gateway-controls";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "পেমেন্ট গেটওয়ে" };

/**
 * Payment gateway configuration.
 *
 * SUPER_ADMIN only — the primary gateway decides where every payment on the
 * site is routed. Each server action re-checks the role independently.
 */
export default async function GatewaysPage() {
  await requireSuperAdmin("/admin/payments/gateways");
  const statuses = await listGatewayStatuses(getDb(), getEnv());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">পেমেন্ট গেটওয়ে</h1>
        <p className="mt-1 text-sm text-ink-500">
          কোন গেটওয়ে দিয়ে টাকা নেওয়া হবে তা এখান থেকে ঠিক করুন।
        </p>
      </div>

      <div className="rounded-[--radius-card] border border-gold-500/30 bg-gold-100 p-4 text-sm leading-relaxed text-gold-700">
        <KeyRound className="mb-1 inline h-4 w-4" aria-hidden="true" /> গেটওয়ের গোপন
        তথ্য (স্টোর আইডি, পাসওয়ার্ড, এপিআই কী) এখানে রাখা হয় না এবং এখান থেকে
        দেখা বা পরিবর্তন করা যায় না। সেগুলো Cloudflare Worker সিক্রেট হিসেবে{" "}
        <code className="font-mono">wrangler secret put</code> দিয়ে সেট করতে হয়।
        &ldquo;কনফিগার্ড&rdquo; অবস্থাটি সরাসরি সেখান থেকেই যাচাই করা হয়।
      </div>

      <ul className="space-y-4">
        {statuses.map((status) => (
          <li
            key={status.id}
            className="rounded-[--radius-card] border border-ink-100 bg-white p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink-900">
                  {status.labelBn}
                  <span className="text-sm font-normal text-ink-400">{status.displayName}</span>
                  {status.isPrimary ? <Badge tone="brand">প্রাইমারি</Badge> : null}
                  {status.isFallback ? <Badge tone="soft">ফলব্যাক</Badge> : null}
                </h2>

                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
                  <StatusPill
                    ok={status.enabled}
                    okLabel="চালু"
                    offLabel="বন্ধ"
                    hint="অ্যাডমিন সেটিং"
                  />
                  <StatusPill
                    ok={status.configured}
                    okLabel="কনফিগার্ড"
                    offLabel="কনফিগার করা নেই"
                    hint="Worker সিক্রেট"
                  />
                  <StatusPill
                    ok={status.usable}
                    okLabel="ব্যবহারযোগ্য"
                    offLabel="ব্যবহার করা যাচ্ছে না"
                    hint="দুটোই ঠিক থাকলে"
                  />
                </div>

                {status.notes ? (
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">{status.notes}</p>
                ) : null}

                {/* A gateway with no integration yet: say exactly what it needs. */}
                {!status.configured && status.requiredSecrets?.length ? (
                  <div className="mt-3 rounded-[--radius-control] bg-ink-50 p-3 text-sm">
                    <p className="font-medium text-ink-800">এটি চালু করতে যা লাগবে</p>
                    <p className="mt-1 leading-relaxed text-ink-600">{status.prerequisite}</p>
                    <p className="mt-2 font-mono text-xs text-ink-500">
                      {status.requiredSecrets.join(" · ")}
                    </p>
                  </div>
                ) : null}

                <ul className="mt-3 flex flex-wrap gap-2 text-xs text-ink-500">
                  {status.capabilities.hostedCheckout ? <Capability>চেকআউট পেজ</Capability> : null}
                  {status.capabilities.webhook ? <Capability>ওয়েবহুক</Capability> : null}
                  {status.capabilities.refund ? <Capability>রিফান্ড</Capability> : null}
                  {status.capabilities.statusCheck ? <Capability>স্ট্যাটাস চেক</Capability> : null}
                  {status.capabilities.manualSettlement ? (
                    <Capability>ম্যানুয়াল নিশ্চিতকরণ</Capability>
                  ) : null}
                </ul>
              </div>

              <GatewayControls
                gatewayId={status.id}
                enabled={status.enabled}
                configured={status.configured}
                isPrimary={status.isPrimary}
                isFallback={status.isFallback}
                settings={status.settings as Record<string, string>}
                editableSettings={status.id === "MANUAL" ? ["account_number", "instructions_bn"] : []}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusPill({
  ok,
  okLabel,
  offLabel,
  hint,
}: {
  ok: boolean;
  okLabel: string;
  offLabel: string;
  hint: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-brand-600" aria-hidden="true" />
      ) : (
        <XCircle className="h-4 w-4 text-ink-400" aria-hidden="true" />
      )}
      <span className={ok ? "text-ink-800" : "text-ink-500"}>{ok ? okLabel : offLabel}</span>
      <span className="text-xs text-ink-400">({hint})</span>
    </span>
  );
}

function Capability({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-[--radius-pill] border border-ink-200 px-2 py-0.5">{children}</li>
  );
}
