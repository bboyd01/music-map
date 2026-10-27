import { createHmac, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { DB } from '../db/client';
import { sessions } from '../db/schema';

export const SESSION_COOKIE = 'mm_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Only extend the sliding expiry this often, to avoid a write on every request. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;

/** Random 256-bit token; only its keyed hash is ever stored. */
export function generateToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string, secret: string): string {
	return createHmac('sha256', secret).update(token).digest('hex');
}

export function createSession(db: DB, secret: string, now = Date.now()) {
	const token = generateToken();
	const expiresAt = new Date(now + SESSION_TTL_MS);
	db.insert(sessions)
		.values({
			idHash: hashToken(token, secret),
			createdAt: new Date(now),
			expiresAt,
			lastSeenAt: new Date(now)
		})
		.run();
	return { token, expiresAt };
}

/** Returns the (possibly extended) expiry if the token is valid, otherwise null. */
export function validateSession(db: DB, secret: string, token: string, now = Date.now()) {
	const idHash = hashToken(token, secret);
	const row = db.select().from(sessions).where(eq(sessions.idHash, idHash)).get();
	if (!row) return null;
	if (row.expiresAt.getTime() <= now) {
		db.delete(sessions).where(eq(sessions.idHash, idHash)).run();
		return null;
	}
	if (now - row.lastSeenAt.getTime() < REFRESH_AFTER_MS) return { expiresAt: row.expiresAt, refreshed: false };
	const expiresAt = new Date(now + SESSION_TTL_MS);
	db.update(sessions)
		.set({ lastSeenAt: new Date(now), expiresAt })
		.where(eq(sessions.idHash, idHash))
		.run();
	return { expiresAt, refreshed: true };
}

export function deleteSession(db: DB, secret: string, token: string) {
	db.delete(sessions).where(eq(sessions.idHash, hashToken(token, secret))).run();
}

export function deleteAllSessions(db: DB) {
	db.delete(sessions).run();
}

export function deleteExpiredSessions(db: DB, now = Date.now()) {
	db.delete(sessions).where(lt(sessions.expiresAt, new Date(now))).run();
}
