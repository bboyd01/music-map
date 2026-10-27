import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
	new Promise<Buffer>((resolve, reject) =>
		scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)))
	);

const KEYLEN = 64;
const DEFAULTS = { N: 2 ** 15, r: 8, p: 1 };
const maxmem = (N: number, r: number) => 256 * N * r;

/** Returns `scrypt:N:r:p:<salt b64>:<hash b64>` (no $, so it survives docker compose interpolation). */
export async function hashPassword(password: string, params = DEFAULTS): Promise<string> {
	const { N, r, p } = params;
	const salt = randomBytes(16);
	const key = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: maxmem(N, r) });
	return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split(':');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
	const [N, r, p] = parts.slice(1, 4).map(Number);
	if (![N, r, p].every(Number.isInteger)) return false;
	const salt = Buffer.from(parts[4], 'base64');
	const expected = Buffer.from(parts[5], 'base64');
	if (expected.length === 0) return false;
	const key = await scrypt(password, salt, expected.length, { N, r, p, maxmem: maxmem(N, r) });
	return timingSafeEqual(key, expected);
}
