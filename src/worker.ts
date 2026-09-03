/**
 * Cloudflare Worker entry point.
 *
 * vinext normally supplies the entry itself (`"main": "vinext/server/fetch-handler"`),
 * which exports only a `fetch` handler. Cloudflare delivers cron triggers to a
 * separate `scheduled` handler, so the Worker needs an entry that exports both.
 * vinext documents this delegation pattern in `fetch-handler.ts`.
 *
 * HTTP behaviour is unchanged: every request goes to the same vinext handler as
 * before, untouched.
 */
import handler from "vinext/server/fetch-handler";
import { runScheduledJobs } from "@/server/jobs/run";

const worker = {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Response | Promise<Response> {
    return handler.fetch(request, env, ctx);
  },

  /**
   * Cron entry point.
   *
   * Awaited rather than passed to `ctx.waitUntil`: the runtime keeps a
   * scheduled invocation alive for the returned promise, and awaiting means a
   * thrown error is reported against the cron rather than swallowed.
   *
   * `runScheduledJobs` contains its own per-job error handling, so one broken
   * job cannot stop the others. What is deliberately NOT caught here is a
   * missing binding, or a run in which some job failed: both re-throw so the
   * invocation is recorded as failed in the Cloudflare dashboard rather than
   * looking healthy while doing nothing.
   */
  async scheduled(controller: ScheduledController, env: { DB?: D1Database }): Promise<void> {
    if (!env.DB) {
      // Fail loudly. A cron that quietly does nothing is indistinguishable
      // from a marketplace with nothing to do.
      throw new Error("[cron] D1 binding `DB` is not configured");
    }

    const report = await runScheduledJobs(env.DB, { cron: controller.cron });

    console.log(
      `[cron] ${controller.cron} — ${report.totalChanged} row(s) changed, ${report.failed} job(s) failed`,
      JSON.stringify(report.results),
    );

    // Surfaces in the Cloudflare dashboard as a failed invocation, so a
    // persistently broken job is visible rather than buried in logs.
    if (report.failed > 0) {
      throw new Error(
        `[cron] ${report.failed} scheduled job(s) failed: ${report.results
          .filter((r) => !r.ok)
          .map((r) => `${r.name}: ${r.error}`)
          .join("; ")}`,
      );
    }
  },
};

export default worker;
