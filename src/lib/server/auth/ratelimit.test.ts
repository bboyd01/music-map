import { describe, expect, it } from 'vitest';
import { LOGIN_LIMITS, LoginRateLimiter } from './ratelimit';

function setup() {
	let now = 1_000_000;
	const limiter = new LoginRateLimiter(LOGIN_LIMITS, () => now);
	return { limiter, advance: (ms: number) => (now += ms) };
}

describe('LoginRateLimiter', () => {
	it('locks an IP out after 5 failures within 15 minutes', () => {
		const { limiter, advance } = setup();
		for (let i = 0; i < 4; i++) limiter.recordFailure('1.1.1.1');
		expect(limiter.retryAfter('1.1.1.1')).toBe(0);
		limiter.recordFailure('1.1.1.1');
		expect(limiter.retryAfter('1.1.1.1')).toBe(15 * 60);
		advance(10 * 60 * 1000);
		expect(limiter.retryAfter('1.1.1.1')).toBe(5 * 60);
		expect(limiter.retryAfter('2.2.2.2')).toBe(0);
	});

	it('releases the lockout once the window passes', () => {
		const { limiter, advance } = setup();
		for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
		advance(15 * 60 * 1000 + 1);
		expect(limiter.retryAfter('ip')).toBe(0);
	});

	it('clears an IP on success', () => {
		const { limiter } = setup();
		for (let i = 0; i < 4; i++) limiter.recordFailure('ip');
		limiter.recordSuccess('ip');
		limiter.recordFailure('ip');
		expect(limiter.retryAfter('ip')).toBe(0);
	});

	it('adds a capped global delay after many failures across IPs', () => {
		const { limiter, advance } = setup();
		for (let i = 0; i < 10; i++) limiter.recordFailure(`ip${i}`);
		expect(limiter.globalDelayMs()).toBe(0);
		limiter.recordFailure('x');
		expect(limiter.globalDelayMs()).toBe(250);
		for (let i = 0; i < 50; i++) limiter.recordFailure(`y${i}`);
		expect(limiter.globalDelayMs()).toBe(3000);
		advance(15 * 60 * 1000 + 1);
		expect(limiter.globalDelayMs()).toBe(0);
	});
});
