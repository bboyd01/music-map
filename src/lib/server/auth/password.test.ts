import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

// Cheap params keep the suite fast; the format and verification path are identical.
const FAST = { N: 1024, r: 8, p: 1 };

describe('password hashing', () => {
	it('verifies the right password and rejects the wrong one', async () => {
		const hash = await hashPassword('hunter2-hunter2', FAST);
		expect(hash).toMatch(/^scrypt:1024:8:1:[^:]+:[^:]+$/);
		expect(hash).not.toContain('$');
		expect(await verifyPassword('hunter2-hunter2', hash)).toBe(true);
		expect(await verifyPassword('hunter2-hunter3', hash)).toBe(false);
	});

	it('salts each hash', async () => {
		expect(await hashPassword('same', FAST)).not.toBe(await hashPassword('same', FAST));
	});

	it('rejects malformed stored hashes', async () => {
		for (const bad of ['', 'plain', 'scrypt:1:2:3', 'bcrypt:1024:8:1:abc:def', 'scrypt:x:8:1:abc:def', 'scrypt:1024:8:1:abc:']) {
			expect(await verifyPassword('x', bad)).toBe(false);
		}
	});
});
