import { buildContext, requireAuth } from "@/server/http/context";
import { guarded, jsonError, jsonOk } from "@/server/http/responses";
import { getPaymentStatus } from "@/server/payments/unlock-service";

/**
 * GET /api/payments/status?tran=... — polled by the payment result page while
 * an IPN is still in flight.
 *
 * Scoped to the caller's own user id, so a guessed transaction id reveals
 * nothing about somebody else's payment.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const context = await buildContext(request);
    const unauthorized = requireAuth(context);
    if (unauthorized) return unauthorized;

    const transactionId = new URL(request.url).searchParams.get("tran");
    if (!transactionId) return jsonError("BAD_REQUEST");

    const payment = await getPaymentStatus(context.db, transactionId, context.user!.id);
    if (!payment) return jsonError("NOT_FOUND");

    return jsonOk(payment);
  });
}
