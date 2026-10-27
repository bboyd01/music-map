import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { jobs } from '../db/schema';
import { MAX_ATTEMPTS, claimNext, enqueue, failJob, recoverInterrupted } from './queue';
import { Worker } from './worker';

describe('job queue', () => {
	it('dedupes waiting jobs per entity and merges payload hints', () => {
		const db = openDb(':memory:');
		const a = enqueue(db, 'enrich', { entityId: 1, providerGenres: ['Jazz'] });
		expect(enqueue(db, 'enrich', { entityId: 1, isrc: 'X' })).toBe(a);
		expect(enqueue(db, 'enrich', { entityId: 2 })).not.toBe(a);
		expect(enqueue(db, 'suggest', { entityId: 1 })).not.toBe(a);
		expect(db.select().from(jobs).all().find((j) => j.id === a)!.payload).toEqual({ entityId: 1, providerGenres: ['Jazz'], isrc: 'X' });
	});

	it('retries with backoff, then fails after max attempts', () => {
		const db = openDb(':memory:');
		enqueue(db, 'enrich', { entityId: 1 }, 0);
		let now = 0;
		const statuses: string[] = [];
		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			const job = claimNext(db, now)!;
			expect(job.attempts).toBe(i + 1);
			statuses.push(failJob(db, job, 'boom', now));
			now += 30_000 * 4 ** i;
			expect(claimNext(db, now - 1)).toBeUndefined();
		}
		expect(statuses).toEqual(['queued', 'queued', 'failed']);
		expect(db.select().from(jobs).get()).toMatchObject({ status: 'failed', lastError: 'boom', attempts: 3 });
	});

	it('requeues jobs interrupted by a restart without duplicating them', () => {
		const db = openDb(':memory:');
		enqueue(db, 'enrich', { entityId: 1 });
		const job = claimNext(db)!;
		expect(job.status).toBe('running');
		expect(enqueue(db, 'enrich', { entityId: 1 })).toBe(job.id); // running counts as pending work
		expect(recoverInterrupted(db)).toBe(1);
		expect(db.select().from(jobs).all()).toHaveLength(1);
		expect(claimNext(db)!.id).toBe(job.id);
	});

	it('worker runs handlers sequentially and records failures', async () => {
		const db = openDb(':memory:');
		const seen: number[] = [];
		const failed: string[] = [];
		const worker = new Worker(
			db,
			{
				enrich: async (j) => {
					if ((j.payload as { entityId: number }).entityId === 2) throw new Error('nope');
					seen.push((j.payload as { entityId: number }).entityId);
				}
			},
			{ onRetry: (_, e) => failed.push(e) }
		);
		enqueue(db, 'enrich', { entityId: 1 });
		enqueue(db, 'enrich', { entityId: 2 });
		enqueue(db, 'enrich', { entityId: 3 });
		expect(await worker.drain()).toBe(3);
		expect(seen).toEqual([1, 3]);
		expect(failed).toEqual(['nope']);
		expect(db.select().from(jobs).all().map((j) => j.status)).toEqual(['done', 'queued', 'done']);
	});
});
