import { NO_STORE_HEADERS } from "@/server/security/headers";

/**
 * JSON helpers for route handlers.
 *
 * Error bodies carry a machine-readable `code` and a Bangla `message` intended
 * for display. Internal details and stack traces never cross this boundary.
 */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYMENT_REQUIRED"
  | "RATE_LIMITED"
  | "CSRF_FAILED"
  | "CAPTCHA_FAILED"
  | "SERVER_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYMENT_REQUIRED: 402,
  RATE_LIMITED: 429,
  CSRF_FAILED: 403,
  CAPTCHA_FAILED: 400,
  SERVER_ERROR: 500,
};

const DEFAULT_MESSAGE_BN: Record<ApiErrorCode, string> = {
  BAD_REQUEST: "অনুরোধটি সঠিক নয়।",
  VALIDATION_FAILED: "দেওয়া তথ্যে সমস্যা আছে। আবার দেখুন।",
  UNAUTHORIZED: "এই কাজটি করতে লগইন করুন।",
  FORBIDDEN: "এই কাজটি করার অনুমতি আপনার নেই।",
  NOT_FOUND: "যা খুঁজছেন তা পাওয়া যায়নি।",
  CONFLICT: "এই কাজটি ইতিমধ্যে সম্পন্ন হয়েছে।",
  PAYMENT_REQUIRED: "এই তথ্য দেখতে পেমেন্ট করতে হবে।",
  RATE_LIMITED: "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।",
  CSRF_FAILED: "নিরাপত্তা যাচাই ব্যর্থ হয়েছে। পেজটি রিফ্রেশ করে আবার চেষ্টা করুন।",
  CAPTCHA_FAILED: "নিরাপত্তা যাচাই সম্পন্ন করুন।",
  SERVER_ERROR: "সার্ভারে সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।",
};

export function jsonOk<T>(data: T, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...(init.headers ?? {}) },
  });
}

/** Public, cacheable JSON (listing data only — never private fields). */
export function jsonPublic<T>(data: T, maxAgeSeconds = 60): Response {
  return Response.json(data, {
    headers: {
      "Cache-Control": `public, max-age=0, s-maxage=${maxAgeSeconds}, stale-while-revalidate=300`,
    },
  });
}

export function jsonError(
  code: ApiErrorCode,
  message?: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json(
    { error: { code, message: message ?? DEFAULT_MESSAGE_BN[code], ...extra } },
    { status: STATUS_BY_CODE[code], headers: NO_STORE_HEADERS },
  );
}

/** Turns a Zod `flatten()` result into a field→message map for the client. */
export function validationError(fieldErrors: Record<string, string[] | undefined>): Response {
  const fields: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages?.length) fields[key] = messages[0];
  }
  return jsonError("VALIDATION_FAILED", undefined, { fields });
}

/**
 * Wraps a route handler so an unexpected throw becomes a clean 500 while the
 * real error is logged server-side.
 */
export async function guarded(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    console.error("[api] unhandled error", error);
    return jsonError("SERVER_ERROR");
  }
}
