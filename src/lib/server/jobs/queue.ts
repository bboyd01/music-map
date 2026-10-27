import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { jobs, type Job } from '../db/schema';

export type JobType = Job['type'];
export const MAX_ATTEMPTS = 3;

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Queues a job unless an identical one (same type and entityId) is already waiting or running.
 * Returns the job id (existing or new).
 */
export function enqueue(db: DbOrTx, type: JobType, payload: { entityId?: number } & Record<string, unknown>, now = Date.now()): number {
	if (payload.entityId !== undefined) {
		const dupe = db
			.select({ id: jobs.id })
			.from(jobs)
			.where(
				and(
					eq(jobs.type, type),
					inArray(jobs.status, ['queued', 'running']),
					sql`json_extract(${jobs.payload}, '$.entityId') = ${payload.entityId}`
				)
			)
			.get();
		if (dupe) {
			// Merge newer hints (e.g. provider genres) into the waiting job.
			db.update(jobs)
				.set({ payload: sql`json_patch(${jobs.payload}, ${JSON.stringify(payload)})` })
				.where(and(eq(jobs.id, dupe.id), eq(jobs.status, 'queued')))
				.run();
			return dupe.id;
		}
	}
	return db.insert(jobs).values({ type, payload, runAfter: iso(now) }).returning({ id: jobs.id }).get().id;
}

/** Atomically takes the oldest due job and marks it running. */
export function claimNext(db: DbOrTx, now = Date.now()): Job | undefined {
	const next = db
		.select({ id: jobs.id })
		.from(jobs)
		.where(and(eq(jobs.status, 'queued'), lte(jobs.runAfter, iso(now))))
		.orderBy(asc(jobs.runAfter), asc(jobs.id))
		.get();
	if (!next) return undefined;
	return db
		.update(jobs)
		.set({ status: 'running', attempts: sql`${jobs.attempts} + 1` })
		.where(and(eq(jobs.id, next.id), eq(jobs.status, 'queued')))
		.returning()
		.get();
}

export function completeJob(db: DbOrTx, id: number) {
	db.update(jobs).set({ status: 'done', lastError: null }).where(eq(jobs.id, id)).run();
}

/** Requeues with exponential backoff (30s, 2m), or marks failed after MAX_ATTEMPTS. Returns the new status. */
export function failJob(db: DbOrTx, job: Job, error: string, now = Date.now()): 'queued' | 'failed' {
	if (job.attempts >= MAX_ATTEMPTS) {
		db.update(jobs).set({ status: 'failed', lastError: error }).where(eq(jobs.id, job.id)).run();
		return 'failed';
	}
	const delay = 30_000 * 4 ** (job.attempts - 1);
	db.update(jobs)
		.set({ status: 'queued', lastError: error, runAfter: iso(now + delay) })
		.where(eq(jobs.id, job.id))
		.run();
	return 'queued';
}

/** On boot: anything left `running` was interrupted by a restart; run it again. */
export function recoverInterrupted(db: DbOrTx): number {
	return db.update(jobs).set({ status: 'queued' }).where(eq(jobs.status, 'running')).run().changes;
}

/** Milliseconds until the next queued job is due, or null if none. */
export function msUntilNextJob(db: DbOrTx, now = Date.now()): number | null {
	const next = db
		.select({ runAfter: jobs.runAfter })
		.from(jobs)
		.where(eq(jobs.status, 'queued'))
		.orderBy(asc(jobs.runAfter))
		.get();
	return next ? Math.max(0, Date.parse(next.runAfter) - now) : null;
}

/** Drops finished jobs older than a week so the table stays small. */
export function pruneJobs(db: DbOrTx, now = Date.now()) {
	db.delete(jobs)
		.where(and(eq(jobs.status, 'done'), lte(jobs.createdAt, iso(now - 7 * 24 * 3600_000))))
		.run();
}
