import type { DB } from '../db/client';
import type { Job } from '../db/schema';
import { claimNext, completeJob, failJob, msUntilNextJob, pruneJobs, recoverInterrupted, type JobType } from './queue';

type JobHandler = (job: Job) => Promise<void>;
interface WorkerHooks {
	/** Called when a job gives up for good (after MAX_ATTEMPTS). */
	onFailed?: (job: Job, error: string) => void;
	/** Called after each failed attempt that will be retried. */
	onRetry?: (job: Job, error: string) => void;
	log?: (msg: string) => void;
}

/** Single sequential in-process worker over the SQLite job table. */
export class Worker {
	private running = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private wake: (() => void) | undefined;
	private idle: Promise<void> = Promise.resolve();

	constructor(
		private db: DB,
		private handlers: Partial<Record<JobType, JobHandler>>,
		private hooks: WorkerHooks = {}
	) {}

	start() {
		if (this.running) return;
		this.running = true;
		const recovered = recoverInterrupted(this.db);
		if (recovered) this.hooks.log?.(`requeued ${recovered} interrupted job(s)`);
		pruneJobs(this.db);
		this.idle = this.loop();
	}

	/** Wakes the loop early, e.g. right after enqueueing. */
	notify() {
		this.wake?.();
	}

	async stop() {
		this.running = false;
		this.notify();
		await this.idle;
	}

	/** Runs every due job now, then returns. Used by tests. */
	async drain(): Promise<number> {
		let n = 0;
		while (await this.runOne()) n++;
		return n;
	}

	private async runOne(): Promise<boolean> {
		const job = claimNext(this.db);
		if (!job) return false;
		const handler = this.handlers[job.type];
		try {
			if (!handler) throw new Error(`no handler for ${job.type}`);
			await handler(job);
			completeJob(this.db, job.id);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const status = failJob(this.db, job, message);
			this.hooks.log?.(`job ${job.id} (${job.type}) attempt ${job.attempts} failed: ${message}`);
			if (status === 'failed') this.hooks.onFailed?.(job, message);
			else this.hooks.onRetry?.(job, message);
		}
		return true;
	}

	private async loop() {
		while (this.running) {
			try {
				if (await this.runOne()) continue;
			} catch (err) {
				this.hooks.log?.(`worker error: ${err}`);
			}
			const wait = Math.min(msUntilNextJob(this.db) ?? 60_000, 60_000);
			await new Promise<void>((resolve) => {
				this.wake = resolve;
				this.timer = setTimeout(resolve, wait);
			});
			clearTimeout(this.timer);
			this.wake = undefined;
		}
	}
}
