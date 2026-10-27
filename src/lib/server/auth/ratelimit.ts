interface RateLimitOptions {
	/** Failed attempts allowed per IP within the window. */
	maxAttempts: number;
	windowMs: number;
	/** Failures across all IPs within the window before a global delay kicks in. */
	globalThreshold: number;
	globalDelayStepMs: number;
	globalDelayMaxMs: number;
}

export const LOGIN_LIMITS: RateLimitOptions = {
	maxAttempts: 5,
	windowMs: 15 * 60 * 1000,
	globalThreshold: 10,
	globalDelayStepMs: 250,
	globalDelayMaxMs: 3000
};

/** In-memory login limiter: per-IP lockout plus a small global delay after repeated failures. */
export class LoginRateLimiter {
	private perIp = new Map<string, number[]>();
	private global: number[] = [];

	constructor(
		private opts: RateLimitOptions = LOGIN_LIMITS,
		private now: () => number = Date.now
	) {}

	private recent(times: number[]) {
		const cutoff = this.now() - this.opts.windowMs;
		return times.filter((t) => t > cutoff);
	}

	/** Seconds until this IP may try again, or 0 if allowed now. */
	retryAfter(ip: string): number {
		const times = this.recent(this.perIp.get(ip) ?? []);
		if (times.length === 0) this.perIp.delete(ip);
		else this.perIp.set(ip, times);
		if (times.length < this.opts.maxAttempts) return 0;
		return Math.ceil((times[0] + this.opts.windowMs - this.now()) / 1000);
	}

	/** Delay to apply to every login attempt while failures are elevated. */
	globalDelayMs(): number {
		this.global = this.recent(this.global);
		const over = this.global.length - this.opts.globalThreshold;
		return over <= 0 ? 0 : Math.min(this.opts.globalDelayMaxMs, over * this.opts.globalDelayStepMs);
	}

	recordFailure(ip: string) {
		const t = this.now();
		this.perIp.set(ip, [...this.recent(this.perIp.get(ip) ?? []), t]);
		this.global.push(t);
	}

	recordSuccess(ip: string) {
		this.perIp.delete(ip);
	}
}
