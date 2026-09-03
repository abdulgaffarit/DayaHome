/**
 * Scheduled marketplace jobs.
 *
 * Time-based state changes — a listing whose window closed, a campaign whose
 * start date arrived — must happen whether or not anyone is looking at the
 * site. Nothing here may depend on a page being rendered, a visitor arriving,
 * or an admin clicking anything.
 *
 * Every job obeys three rules, and the tests assert all three:
 *
 *   1. IDEMPOTENT. Each job is a status-conditional `UPDATE ... WHERE`, so a
 *      second run in the same minute changes zero rows. Cron delivery is
 *      at-least-once; a duplicate invocation must be a no-op, not a double
 *      transition.
 *   2. OVERLAP-SAFE. Two runs racing each other cannot both apply the same
 *      transition, for the same reason — whichever loses matches no rows.
 *   3. INDEPENDENT. A job that throws does not stop the ones after it. A bug
 *      in advertising must never leave property listings unexpired.
 *
 * Jobs never delete. They move rows between states that the owner or an admin
 * can move back.
 */
import { expireStaleProperties } from "@/server/properties/mutations";
import { runCampaignSchedule } from "@/server/advertising/campaigns";

export interface JobOutcome {
  /** Rows this job actually transitioned. Zero is the normal steady state. */
  changed: number;
  /** Per-transition breakdown, for the run log. */
  detail?: Record<string, number>;
}

export interface ScheduledJob {
  /** Stable identifier. Appears in the run log and in `runScheduledJobs({ only })`. */
  name: string;
  /** What it does, for the admin screen and for whoever reads the log. */
  summary: string;
  run(db: D1Database): Promise<JobOutcome>;
}

/**
 * The registry.
 *
 * Order matters only within a job, never between them: no job here reads state
 * another job in the same run has written. Adding a job that does would be a
 * design change, not a new array entry.
 */
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  {
    name: "expire-properties",
    summary: "Marks APPROVED listings whose expires_at has passed as EXPIRED.",
    async run(db) {
      const changed = await expireStaleProperties(db);
      return { changed, detail: { expired: changed } };
    },
  },
  {
    name: "advertising-schedule",
    summary:
      "Starts campaigns whose window has opened and ends those whose window has closed.",
    async run(db) {
      // Activation and expiry are deliberately ONE job rather than two.
      // They must run in this order: a campaign whose whole window opened and
      // closed between two runs has to be activated before it can be expired,
      // or it would sit in SCHEDULED forever. Splitting them into separate
      // registry entries would make that ordering an accident of array
      // position rather than a guarantee.
      const { activated, expired } = await runCampaignSchedule(db);
      return { changed: activated + expired, detail: { activated, expired } };
    },
  },
];

export function findJob(name: string): ScheduledJob | undefined {
  return SCHEDULED_JOBS.find((job) => job.name === name);
}
