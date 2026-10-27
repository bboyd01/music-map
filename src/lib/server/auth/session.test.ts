import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { sessions } from '../db/schema';
import {
	SESSION_TTL_MS,
	createSession,
	deleteAllSessions,
	deleteSession,
	hashToken,
	validateSession
} from './session';

const SECRET = 'x'.repeat(32);
const HOUR = 60 * 60 * 1000;

describe('sessions', () => {
	it('stores only a keyed hash of the token', () => {
		const db = openDb(':memory:');
		const { token } = createSession(db, SECRET, 0);
		const rows = db.select().from(sessions).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].idHash).toBe(hashToken(token, SECRET));
		expect(rows[0].idHash).not.toContain(token);
		expect(hashToken(token, 'y'.repeat(32))).not.toBe(rows[0].idHash);
	});

	it('validates, slides the expiry, and expires', () => {
		const db = openDb(':memory:');
		const { token } = createSession(db, SECRET, 0);
		expect(validateSession(db, SECRET, 'nope', 0)).toBeNull();
		expect(validateSession(db, SECRET, token, 10)).toMatchObject({ refreshed: false });

		const later = 20 * 24 * HOUR;
		const refreshed = validateSession(db, SECRET, token, later);
		expect(refreshed?.refreshed).toBe(true);
		expect(refreshed?.expiresAt.getTime()).toBe(later + SESSION_TTL_MS);

		expect(validateSession(db, SECRET, token, later + SESSION_TTL_MS + 1)).toBeNull();
		expect(db.select().from(sessions).all()).toHaveLength(0);
	});

	it('logs out one session or all of them', () => {
		const db = openDb(':memory:');
		const a = createSession(db, SECRET, 0);
		const b = createSession(db, SECRET, 0);
		deleteSession(db, SECRET, a.token);
		expect(validateSession(db, SECRET, a.token, 1)).toBeNull();
		expect(validateSession(db, SECRET, b.token, 1)).not.toBeNull();
		createSession(db, SECRET, 0);
		deleteAllSessions(db);
		expect(db.select().from(sessions).all()).toHaveLength(0);
	});
});
