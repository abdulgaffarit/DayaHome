/**
 * Gateway registry.
 *
 * Resolves which gateway handles a payment, from two independent sources:
 *
 *   - the database (`payment_gateways`): the operator's intent — enabled,
 *     primary, fallback, non-secret settings;
 *   - the Worker bindings: whether the credentials actually exist.
 *
 * A gateway is usable only when BOTH agree. Enabling a gateway in the admin UI
 * cannot make it work without its secrets, and adding secrets cannot silently
 * start routing money through a gateway nobody enabled.
 */
import type { GatewayId } from "@/domain/payments";
import { isGatewayId } from "@/domain/payments";
import { queryAll, queryOne } from "@/server/db/client";
import type { AppEnv } from "@/server/cloudflare/env";
import type { PaymentGateway } from "./gateway";
import { SslcommerzGateway } from "./gateways/sslcommerz";
import { ManualGateway, type ManualGatewaySettings } from "./gateways/manual";
import { PENDING_INTEGRATIONS, UnconfiguredGateway } from "./gateways/unconfigured";

export interface GatewayRecord {
  id: GatewayId;
  display_name: string;
  label_bn: string;
  is_enabled: number;
  is_primary: number;
  is_fallback: number;
  sort_order: number;
  settings_json: string;
  notes: string | null;
}

/** A gateway plus the live judgement of whether it can actually be used. */
export interface GatewayStatus {
  id: GatewayId;
  displayName: string;
  labelBn: string;
  enabled: boolean;
  isPrimary: boolean;
  isFallback: boolean;
  /** Credentials present in the Worker bindings right now. */
  configured: boolean;
  /** enabled AND configured. Only these may take a payment. */
  usable: boolean;
  capabilities: PaymentGateway["capabilities"];
  notes: string | null;
  /** Non-secret settings, for the admin form. */
  settings: Record<string, unknown>;
  /** Secrets a not-yet-integrated gateway will need. */
  requiredSecrets?: string[];
  prerequisite?: string;
}

function parseSettings(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Builds the adapter for one gateway id.
 *
 * Secrets come from `env`, never from the database — the settings column holds
 * only non-secret operational values.
 */
export function buildGateway(
  id: GatewayId,
  env: AppEnv,
  settings: Record<string, unknown> = {},
): PaymentGateway {
  switch (id) {
    case "SSLCOMMERZ":
      return new SslcommerzGateway({
        storeId: env.SSLCOMMERZ_STORE_ID,
        storePassword: env.SSLCOMMERZ_STORE_PASSWORD,
        // Anything but an explicit "false" stays in the sandbox.
        isSandbox: String(env.SSLCOMMERZ_IS_SANDBOX ?? "true") !== "false",
      });
    case "MANUAL":
      return new ManualGateway(settings as ManualGatewaySettings);
    default: {
      const pending = PENDING_INTEGRATIONS.find((p) => p.id === id);
      if (!pending) throw new Error(`Unknown gateway: ${id}`);
      return new UnconfiguredGateway(pending);
    }
  }
}

async function loadRecords(db: D1Database): Promise<GatewayRecord[]> {
  const rows = await queryAll<GatewayRecord>(
    db,
    `SELECT id, display_name, label_bn, is_enabled, is_primary, is_fallback,
            sort_order, settings_json, notes
       FROM payment_gateways
      ORDER BY sort_order ASC`,
  );
  return rows.filter((row) => isGatewayId(row.id));
}

/** Every gateway with its live status. Powers the admin screen. */
export async function listGatewayStatuses(
  db: D1Database,
  env: AppEnv,
): Promise<GatewayStatus[]> {
  const records = await loadRecords(db);

  return records.map((record) => {
    const settings = parseSettings(record.settings_json);
    const adapter = buildGateway(record.id, env, settings);
    const configured = adapter.isConfigured();
    const enabled = record.is_enabled === 1;
    const pending = PENDING_INTEGRATIONS.find((p) => p.id === record.id);

    return {
      id: record.id,
      displayName: record.display_name,
      labelBn: record.label_bn,
      enabled,
      isPrimary: record.is_primary === 1,
      isFallback: record.is_fallback === 1,
      configured,
      usable: enabled && configured,
      capabilities: adapter.capabilities,
      notes: record.notes,
      settings,
      requiredSecrets: pending?.requiredSecrets,
      prerequisite: pending?.prerequisite,
    };
  });
}

export type GatewayResolution =
  | { ok: true; gateway: PaymentGateway; usedFallback: boolean }
  | { ok: false; reason: "NO_USABLE_GATEWAY" };

/**
 * Picks the gateway to take a payment.
 *
 * Order: primary, then fallback, then any other enabled + configured gateway.
 * A gateway that is enabled but missing credentials is skipped rather than
 * attempted — better to fall through to one that works than to fail the
 * purchase.
 */
export async function resolveGateway(
  db: D1Database,
  env: AppEnv,
  preferred?: GatewayId,
): Promise<GatewayResolution> {
  const records = await loadRecords(db);

  const usable = records
    .map((record) => {
      const settings = parseSettings(record.settings_json);
      const adapter = buildGateway(record.id, env, settings);
      return { record, adapter, ok: record.is_enabled === 1 && adapter.isConfigured() };
    })
    .filter((entry) => entry.ok);

  if (usable.length === 0) return { ok: false, reason: "NO_USABLE_GATEWAY" };

  // An explicit choice by the payer wins, but only among usable gateways.
  if (preferred) {
    const chosen = usable.find((entry) => entry.record.id === preferred);
    if (chosen) return { ok: true, gateway: chosen.adapter, usedFallback: false };
  }

  const primary = usable.find((entry) => entry.record.is_primary === 1);
  if (primary) return { ok: true, gateway: primary.adapter, usedFallback: false };

  const fallback = usable.find((entry) => entry.record.is_fallback === 1);
  if (fallback) return { ok: true, gateway: fallback.adapter, usedFallback: true };

  return { ok: true, gateway: usable[0].adapter, usedFallback: true };
}

/**
 * Rebuilds the adapter that created a payment, for verification or refund.
 *
 * Always resolved from the stored `gateway` column, never from the current
 * primary — a payment must be verified by the gateway that took it, even if an
 * administrator has since switched primaries.
 */
export async function gatewayForPayment(
  db: D1Database,
  env: AppEnv,
  gatewayId: string,
): Promise<PaymentGateway | null> {
  if (!isGatewayId(gatewayId)) return null;

  const record = await queryOne<{ settings_json: string }>(
    db,
    `SELECT settings_json FROM payment_gateways WHERE id = ?`,
    [gatewayId],
  );
  return buildGateway(gatewayId, env, parseSettings(record?.settings_json ?? "{}"));
}

/** Gateways a payer may choose from, for the checkout screen. */
export async function listPayableGateways(
  db: D1Database,
  env: AppEnv,
): Promise<{ id: GatewayId; labelBn: string; manual: boolean }[]> {
  const statuses = await listGatewayStatuses(db, env);
  return statuses
    .filter((status) => status.usable)
    .map((status) => ({
      id: status.id,
      labelBn: status.labelBn,
      manual: status.capabilities.manualSettlement,
    }));
}
