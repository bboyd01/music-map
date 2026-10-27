import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/client';
import { edges, entities, externalIds, listItems } from '../db/schema';
import { requeueEnriched, type EnrichPayload } from './pipeline';

let db: DB;
beforeEach(() => {
	db = openDb(':memory:');
});

const add = (kind: 'artist' | 'album', name: string, artistId?: number) =>
	db.insert(entities).values({ kind, name, normKey: `${kind}|${name}`, artistId, enrichStatus: 'done' }).returning().get().id;

describe('requeueEnriched', () => {
	it('queues library items, releases first, and skips unaccepted suggestion stubs', () => {
		const miles = add('artist', 'Miles Davis');
		const kob = add('album', 'Kind of Blue', miles);
		db.insert(listItems).values({ entityId: kob }).run();
		const matched = add('album', 'Sketches of Spain', miles);
		db.insert(listItems).values({ entityId: matched }).run();
		db.insert(externalIds).values({ entityId: matched, provider: 'musicbrainz', externalId: 'rg' }).run();
		const accepted = add('artist', 'Bill Evans');
		const stub = add('artist', 'Gil Evans');
		db.insert(edges).values({ type: 'similar', fromId: miles, toId: accepted, status: 'accepted', source: 'manual' }).run();
		db.insert(edges).values({ type: 'similar', fromId: miles, toId: stub, status: 'suggested', source: 'lastfm' }).run();

		const queued: EnrichPayload[] = [];
		expect(requeueEnriched(db, (p) => queued.push(p))).toBe(4);
		expect(queued.map((p) => p.entityId)).toEqual([kob, matched, miles, accepted]);
		expect(db.select().from(entities).where(eq(entities.id, kob)).get()!.enrichStatus).toBe('pending');
		expect(db.select().from(entities).where(eq(entities.id, stub)).get()!.enrichStatus).toBe('done');

		// The one-time MusicBrainz catch-up skips what's already matched (and what's now pending).
		db.update(entities).set({ enrichStatus: 'done' }).run();
		const missing: number[] = [];
		requeueEnriched(db, (p) => missing.push(p.entityId), { missingMusicBrainz: true });
		expect(missing).toEqual([kob, miles, accepted]);
	});
});
