/**
 * The scheduled-job runner.
 *
 * One entry point, called from the Worker's `scheduled` handler and usable
 * from a test or an ops script with no Worker at all — it takes the database
 * as a parameter like every other service in this codebase.
 */
import { execute } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { SCHEDULED_JOBS, type ScheduledJob } from "./registry";

export interface JobRunResult {
  name: string;
  ok: boolean;
  changed: number;
  detail?: Record<string, number>;
  /** Present only when the job threw. */
  error?: string;
  durationMs: number;
}

export interface ScheduledRunReport {
  startedAt: string;
  /** The cron pattern that fired, when there was one. */
  cron?: string;
  results: JobRunResult[];
  totalChanged: number;
  failed: number;
}

/**
 * Runs every registered job, or the named subset.
 *
 * Sequential by design. These jobs are short conditional UPDATEs against a
 * single D1 database; running them in parallel would buy nothing and would
 * make the run log harder to read when one of them misbehaves.
 */
export async function runScheduledJobs(
  db: D1Database,
  options: { only?: readonly string[]; cron?: string } = {},
): Promise<ScheduledRunReport> {
  const startedAt = nowIso();
  const jobs: readonly ScheduledJob[] = options.only
    ? SCHEDULED_JOBS.filter((job) => options.only!.includes(job.name))
    : SCHEDULED_JOBS;

  const results: JobRunResult[] = [];

  for (const job of jobs) {
    const began = Date.now();
    try {
      const outcome = await job.run(db);
      results.push({
        name: job.name,
        ok: true,
        changed: outcome.changed,
        detail: outcome.detail,
        durationMs: Date.now() - began,
      });
    } catch (error) {
      // Contained on purpose: the remaining jobs still run. A failure in the
      // advertising sweep must not leave expired listings on the site.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[cron] job "${job.name}" failed`, error);
      results.push({
        name: job.name,
        ok: false,
        changed: 0,
        error: message,
        durationMs: Date.now() - began,
      });
    }
  }

  const report: ScheduledRunReport = {
    startedAt,
    cron: options.cron,
    results,
    totalChanged: results.reduce((sum, r) => sum + r.changed, 0),
    failed: results.filter((r) => !r.ok).length,
  };

  await recordRun(db, report);
  return report;
}

/**
 * Writes one row per run to the existing audit trail.
 *
 * `admin_id` is NULL — no human performed this — which the column already
 * allows. Recording failures matters more than recording successes: a cron
 * that silently stopped working looks exactly like a quiet marketplace.
 *
 * A logging failure never fails the run: the state transitions have already
 * been committed and are correct.
 */
async function recordRun(db: D1Database, report: ScheduledRunReport): Promise<void> {
  try {
    await execute(
      db,
      `INSERT INTO admin_logs (id, admin_id, action, entity_type, entity_id, metadata, created_at)
       VALUES (?, NULL, 'CRON_RUN', 'cron', ?, ?, ?)`,
      [
        newId("log"),
        report.cron ?? null,
        JSON.stringify({
          totalChanged: report.totalChanged,
          failed: report.failed,
          jobs: report.results.map((r) => ({
            name: r.name,
            ok: r.ok,
            changed: r.changed,
            detail: r.detail,
            error: r.error,
          })),
        }).slice(0, 4000),
        report.startedAt,
      ],
    );
  } catch (error) {
    console.error("[cron] failed to record the run log", error);
  }
}
