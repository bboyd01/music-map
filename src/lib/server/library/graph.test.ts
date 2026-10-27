import { describe, expect, it } from 'vitest';
import { openDb } from '../db/client';
import { entities, listItems } from '../db/schema';
import { setAutoTags } from '../enrich/tags';
import { GraphQuery, getGraph } from './graph';
import { addEdge } from './relations';

function setup() {
	const db = openDb(':memory:');
	const add = (kind: 'artist' | 'album' | 'track', name: string, artistId?: number) =>
		db.insert(entities).values({ kind, name, normKey: name, artistId }).returning().get();
	const miles = add('artist', 'Miles Davis');
	const evans = add('artist', 'Bill Evans');
	const coltrane = add('artist', 'John Coltrane');
	const kob = add('album', 'Kind of Blue', miles.id);
	const sketches = add('album', 'Sketches of Spain', miles.id);
	const supreme = add('album', 'A Love Supreme', coltrane.id);
	db.insert(listItems).values([{ entityId: kob.id }, { entityId: sketches.id }]).run();
	addEdge(db, { type: 'inspired', from: evans.id, to: miles.id });
	addEdge(db, { type: 'similar', from: kob.id, to: supreme.id });
	addEdge(db, { type: 'inspired', from: evans.id, to: kob.id }); // cross-kind: shown in neither view
	setAutoTags(db, miles.id, 'genre', ['jazz']);
	setAutoTags(db, supreme.id, 'genre', ['spiritual jazz']);
	return { db, miles, evans, kob, sketches, supreme };
}
const q = (params: Record<string, string>) => GraphQuery.parse(params);

describe('getGraph', () => {
	it('shows only the chosen kind and the edges directly between them', () => {
		const { db, kob, supreme } = setup();
		const artists = getGraph(db, q({ kind: 'artist', layers: 'inspired,similar' }));
		expect(artists.nodes.map((n) => n.label).sort()).toEqual(['Bill Evans', 'John Coltrane', 'Miles Davis']);
		expect(artists.links.map((l) => l.type)).toEqual(['inspired']);
		const albums = getGraph(db, q({ kind: 'album', layers: 'inspired,similar' }));
		expect(albums.links.map((l) => [l.source, l.target])).toEqual([[`e${kob.id}`, `e${supreme.id}`]]);
		expect(albums.nodes.find((n) => n.entityId === supreme.id)?.stub).toBe(true);
		expect(getGraph(db, q({ kind: 'track' })).nodes).toEqual([]);
	});

	it('treats artists with a listed release as in the library, others as stubs', () => {
		const { db, miles, evans } = setup();
		const nodes = getGraph(db, q({ kind: 'artist' })).nodes;
		expect(nodes.find((n) => n.entityId === miles.id)?.stub).toBe(false);
		expect(nodes.find((n) => n.entityId === evans.id)?.stub).toBe(true);
	});

	it('clusters on inherited genre tags', () => {
		const { db, kob, sketches } = setup();
		const g = getGraph(db, q({ kind: 'album', layers: 'genre' }));
		const hub = g.nodes.find((n) => n.type === 'hub');
		expect(hub).toMatchObject({ label: 'jazz', size: 2 }); // both inherit "jazz" from Miles Davis
		expect(g.links.map((l) => l.source).sort()).toEqual([`e${kob.id}`, `e${sketches.id}`].sort());
	});

	it('parses query defaults and rejects junk', () => {
		expect(q({})).toMatchObject({ kind: 'artist', layers: ['inspired', 'similar', 'genre'], depth: 2, suggested: false });
		expect(q({ layers: 'era,bogus', tag: 'genre:cool-jazz', suggested: '1' })).toMatchObject({
			layers: ['era'],
			tag: { facet: 'genre', slug: 'cool-jazz' },
			suggested: true
		});
		expect(GraphQuery.safeParse({ tag: 'genre:DROP TABLE' }).success).toBe(false);
	});
});
