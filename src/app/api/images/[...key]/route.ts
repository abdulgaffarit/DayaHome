import { getPropertyImagesBucket } from "@/server/cloudflare/env";

/**
 * GET /api/images/{objectKey} — streams a property photo out of R2.
 *
 * The bucket itself stays private: nothing is publicly readable except through
 * this route. Object keys are random and unguessable, and listing photos are
 * public information anyway, so no per-request authorization is applied — but
 * the key namespace is pinned to `properties/` so this route can never be used
 * to read some other prefix in the bucket.
 *
 * For production, point NEXT_PUBLIC_IMAGE_BASE_URL at a custom domain in front
 * of the bucket so images are served from the edge without touching the Worker.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const objectKey = key.join("/");

  // Reject traversal attempts and anything outside the properties prefix.
  if (!objectKey.startsWith("properties/") || objectKey.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const object = await getPropertyImagesBucket().get(objectKey);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Keys are immutable, so this can be cached hard.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(object.body, { headers });
}
