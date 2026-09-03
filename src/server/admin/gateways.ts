/**
 * Payment gateway administration.
 *
 * Only the operator's *intent* is stored — enabled, primary, fallback and
 * non-secret settings. Credentials never pass through here; whether a gateway
 * is actually usable is resolved at runtime from the Worker bindings.
 */
import type { GatewayId } from "@/domain/payments";
import { batch, changes, execute } from "@/server/db/client";
import { nowIso } from "@/lib/time";
import { recordAdminAction } from "./audit";

/** Settings keys an administrator may edit. Anything else is ignored. */
const EDITABLE_SETTINGS: Record<string, readonly string[]> = {
  MANUAL: ["instructions_bn", "account_number"],
  SSLCOMMERZ: [],
  BKASH: [],
  NAGAD: [],
  ROCKET: [],
};

export async function setGatewayEnabled(
  db: D1Database,
  adminId: string,
  gatewayId: GatewayId,
  enabled: boolean,
  opts: { ipHash?: string | null } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const now = nowIso();
  const result = await execute(
    db,
    `UPDATE payment_gateways SET is_enabled = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    [enabled ? 1 : 0, adminId, now, gatewayId],
  );
  if (changes(result) !== 1) return { ok: false, reason: "NOT_FOUND" };

  // A disabled gateway must not remain primary or fallback, or resolution
  // would keep pointing at something the operator just switched off.
  if (!enabled) {
    await execute(
      db,
      `UPDATE payment_gateways SET is_primary = 0, is_fallback = 0 WHERE id = ?`,
      [gatewayId],
    );
  }

  await recordAdminAction(db, {
    adminId,
    action: "SETTING_UPDATED",
    entityType: "payment_gateway",
    entityId: gatewayId,
    metadata: { enabled },
    ipHash: opts.ipHash,
  });
  return { ok: true };
}

/**
 * Sets the primary or fallback gateway.
 *
 * Both are single-valued, enforced by partial unique indexes, so the previous
 * holder is cleared in the same batch — otherwise the write would violate the
 * index rather than replace the value.
 */
export async function setGatewayRole(
  db: D1Database,
  adminId: string,
  gatewayId: GatewayId,
  role: "primary" | "fallback",
  opts: { ipHash?: string | null } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const column = role === "primary" ? "is_primary" : "is_fallback";
  const other = role === "primary" ? "is_fallback" : "is_primary";
  const now = nowIso();

  await batch(db, [
    // Clear the current holder first.
    { sql: `UPDATE payment_gateways SET ${column} = 0 WHERE ${column} = 1`, params: [] },
    // A gateway cannot be both primary and fallback.
    {
      sql: `UPDATE payment_gateways SET ${column} = 1, ${other} = 0, updated_by = ?, updated_at = ?
             WHERE id = ? AND is_enabled = 1`,
      params: [adminId, now, gatewayId],
    },
  ]);

  await recordAdminAction(db, {
    adminId,
    action: "SETTING_UPDATED",
    entityType: "payment_gateway",
    entityId: gatewayId,
    metadata: { role },
    ipHash: opts.ipHash,
  });
  return { ok: true };
}

export async function updateGatewaySettings(
  db: D1Database,
  adminId: string,
  gatewayId: GatewayId,
  settings: Record<string, string>,
  opts: { ipHash?: string | null } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const allowed = EDITABLE_SETTINGS[gatewayId] ?? [];
  if (allowed.length === 0) return { ok: false, reason: "NO_EDITABLE_SETTINGS" };

  // Whitelist: a posted key that is not editable is dropped, so a crafted form
  // cannot smuggle a credential-shaped field into the settings JSON.
  const filtered: Record<string, string> = {};
  for (const key of allowed) {
    if (typeof settings[key] === "string") filtered[key] = settings[key].slice(0, 1000);
  }

  await execute(
    db,
    `UPDATE payment_gateways SET settings_json = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(filtered), adminId, nowIso(), gatewayId],
  );

  await recordAdminAction(db, {
    adminId,
    action: "SETTING_UPDATED",
    entityType: "payment_gateway",
    entityId: gatewayId,
    // Values are non-secret by construction, but only the keys are logged.
    metadata: { keys: Object.keys(filtered) },
    ipHash: opts.ipHash,
  });
  return { ok: true };
}
