import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { groupRelations } from '../../domain/edges';
import { openDb } from '../db/client';
import { edges, entities, entityTags, externalIds, listItems } from '../db/schema';
import { setAutoTags, setManualTags, tagsFor } from '../enrich/tags';
import { removeFromList } from './list';
import { mergeEntities } from './merge';
import { addEdge, createStub, removeEdge, searchEntities } from './relations';

function setup() {
	const db = openDb(':memory:');
	const add = (kind: 'artist' | 'album' | 'track', name: string, extra: Partial<typeof entities.$inferInsert> = {}) =>
		db.insert(entities).values({ kind, name, normKey: `${kind}|${name.toLowerCase()}`, ...extra }).returning().get();
	return { db, add };
}

describe('edges', () => {
	it('one inspired row reads as Inspired on A and Inspired by on B', () => {
		const { db, add } = setup();
		const a = add('artist', 'Coltrane');
		const b = add('artist', 'Pharoah Sanders');
		expect(addEdge(db, { type: 'inspired', from: a.id, to: b.id })).toMatchObject({ ok: true, created: true });
		const all = db.select().from(edges).all();
		expect(all).toHaveLength(1);
		expect(groupRelations(a.id, all).inspired.map((e) => e.otherId)).toEqual([b.id]);
		expect(groupRelations(b.id, all).inspiredBy.map((e) => e.otherId)).toEqual([a.id]);
	});

	it('similar is symmetric and cannot be duplicated from the other side', () => {
		const { db, add } = setup();
		const a = add('album', 'A');
		const b = add('album', 'B');
		const first = addEdge(db, { type: 'similar', from: b.id, to: a.id });
		const second = addEdge(db, { type: 'similar', from: a.id, to: b.id });
		expect(first).toMatchObject({ ok: true, created: true, edge: { fromId: a.id, toId: b.id } });
		expect(second).toMatchObject({ ok: true, created: false });
		expect(db.select().from(edges).all()).toHaveLength(1);
	});

	it('rejects self-links and unknown entities; re-adding a rejected suggestion accepts it', () => {
		const { db, add } = setup();
		const a = add('artist', 'A');
		const b = add('artist', 'B');
		expect(addEdge(db, { type: 'similar', from: a.id, to: a.id })).toMatchObject({ ok: false, status: 400 });
		expect(addEdge(db, { type: 'inspired', from: a.id, to: 999 })).toMatchObject({ ok: false, status: 404 });
		const e = addEdge(db, { type: 'inspired', from: a.id, to: b.id });
		if (!e.ok) throw new Error();
		db.update(edges).set({ status: 'rejected' }).where(eq(edges.id, e.edge.id)).run();
		expect(addEdge(db, { type: 'inspired', from: a.id, to: b.id })).toMatchObject({ ok: true, created: false, edge: { status: 'accepted' } });
	});

	it('deleting a list item keeps the entity if it has edges; removing the edge then cleans up the stub', () => {
		const { db, add } = setup();
		const album = add('album', 'Kind of Blue');
		const stub = add('artist', 'Bill Evans');
		db.insert(listItems).values({ entityId: album.id }).run();
		const e = addEdge(db, { type: 'inspired', from: stub.id, to: album.id });
		if (!e.ok) throw new Error();
		expect(removeFromList(db, album.id).deletedEntities).toEqual([]);
		expect(db.select().from(entities).all()).toHaveLength(2);
		// rejected edges don't keep entities alive
		db.update(edges).set({ status: 'rejected' }).where(eq(edges.id, e.edge.id)).run();
		expect(removeEdge(db, e.edge.id).deletedEntities.sort()).toEqual([album.id, stub.id].sort());
	});
});

describe('stubs and search', () => {
	it('creates stubs inline, reusing existing entities with the same identity', () => {
		const { db } = setup();
		const s = createStub(db, { kind: 'album', name: 'A Love Supreme', artistName: 'John Coltrane' });
		expect(s.created).toBe(true);
		expect(s.entity.artistId).not.toBeNull();
		expect(createStub(db, { kind: 'album', name: 'a love supreme', artistName: 'John Coltrane' })).toMatchObject({ created: false, entity: { id: s.entity.id } });
		expect(createStub(db, { kind: 'artist', name: 'John Coltrane' }).created).toBe(false);
		expect(db.select().from(listItems).all()).toEqual([]);
	});

	it('searches own entities by name or artist, prefix matches first', () => {
		const { db } = setup();
		createStub(db, { kind: 'album', name: 'A Love Supreme', artistName: 'John Coltrane' });
		createStub(db, { kind: 'album', name: 'Giant Steps', artistName: 'John Coltrane' });
		expect(searchEntities(db, 'coltrane', 'album').map((r) => r.name).sort()).toEqual(['A Love Supreme', 'Giant Steps']);
		expect(searchEntities(db, 'giant')).toEqual([expect.objectContaining({ name: 'Giant Steps', artistName: 'John Coltrane', listed: false })]);
		expect(searchEntities(db, 'john').map((r) => r.kind)[0]).toBe('artist');
		expect(searchEntities(db, '  ')).toEqual([]);
	});
});

describe('mergeEntities', () => {
	it('moves ids, list data, tags, edges and children onto the target', () => {
		const { db, add } = setup();
		const target = add('artist', 'Miles Davis');
		const source = add('artist', 'Miles Davis Quintet');
		const other = add('artist', 'Gil Evans');
		const album = add('album', 'Sketches of Spain', { artistId: source.id });
		db.insert(externalIds).values({ entityId: source.id, provider: 'spotify', externalId: 'sp1' }).run();
		setManualTags(db, target.id, 'genre', ['jazz']);
		setAutoTags(db, source.id, 'genre', ['cool jazz']);
		setAutoTags(db, source.id, 'instrument', ['trumpet']);
		addEdge(db, { type: 'similar', from: source.id, to: other.id });
		addEdge(db, { type: 'similar', from: target.id, to: other.id }); // would duplicate after merge
		addEdge(db, { type: 'inspired', from: source.id, to: target.id }); // would become a self-link

		expect(mergeEntities(db, source.id, target.id)).toEqual({ ok: true, id: target.id });
		expect(db.select().from(entities).where(eq(entities.id, source.id)).get()).toBeUndefined();
		expect(db.select().from(externalIds).all()).toEqual([expect.objectContaining({ entityId: target.id, externalId: 'sp1' })]);
		expect(db.select().from(entities).where(eq(entities.id, album.id)).get()!.artistId).toBe(target.id);
		const t = tagsFor(db, [target.id]).get(target.id)!.map((x) => `${x.facet}:${x.name}:${x.source}`).sort();
		expect(t).toEqual(['genre:jazz:manual', 'instrument:trumpet:auto']);
		expect(db.select().from(edges).all().map((e) => [e.type, e.fromId, e.toId])).toEqual([['similar', target.id, other.id]]);
		expect(db.select().from(entityTags).all().every((r) => r.entityId !== source.id)).toBe(true);
	});

	it('combines list items, keeping the target values and filling gaps', () => {
		const { db, add } = setup();
		const a = add('album', 'Kind of Blue');
		const b = add('album', 'Kind Of Blue (Spotify)');
		db.insert(listItems).values([
			{ entityId: a.id, status: 'to_listen', addedAt: '2026-02-01' },
			{ entityId: b.id, status: 'listened', rating: 9, review: 'Great', listenedAt: '2026-01-15', addedAt: '2026-01-01' }
		]).run();
		mergeEntities(db, b.id, a.id);
		expect(db.select().from(listItems).all()).toEqual([
			expect.objectContaining({ entityId: a.id, status: 'listened', rating: 9, review: 'Great', listenedAt: '2026-01-15', addedAt: '2026-01-01' })
		]);
	});

	it('refuses different kinds, same id and unknown ids', () => {
		const { db, add } = setup();
		const a = add('artist', 'A');
		const b = add('album', 'B');
		expect(mergeEntities(db, a.id, b.id)).toMatchObject({ ok: false, status: 400 });
		expect(mergeEntities(db, a.id, a.id)).toMatchObject({ ok: false, status: 400 });
		expect(mergeEntities(db, a.id, 999)).toMatchObject({ ok: false, status: 404 });
	});
});
