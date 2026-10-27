import { describe, expect, it } from 'vitest';
import { buildGraph, LAYERS, type EffectiveTagMap, type GraphEntity, type StoredEdge } from './graph';

const ent = (id: number, listed = true): GraphEntity => ({ id, name: `E${id}`, kind: 'artist', artistName: null, artworkPath: null, listed });
const edge = (id: number, type: StoredEdge['type'], fromId: number, toId: number, status: StoredEdge['status'] = 'accepted'): StoredEdge => ({
	id,
	type,
	fromId,
	toId,
	status
});

// 1 inspired 2, 2 similar 3, 3 inspired 4 (suggested), 1 similar 4 (rejected); jazz on 1,2,3; 1950s on 1 only.
const entities = [ent(1), ent(2), ent(3), ent(4, false)];
const edges = [edge(10, 'inspired', 1, 2), edge(11, 'similar', 2, 3), edge(12, 'inspired', 3, 4, 'suggested'), edge(13, 'similar', 1, 4, 'rejected')];
const jazz = { name: 'jazz', slug: 'jazz' };
const tags: EffectiveTagMap = new Map([
	[1, { genre: [jazz], era: [{ name: '1950s', slug: '1950s' }] }],
	[2, { genre: [jazz] }],
	[3, { genre: [jazz] }]
]);
const linkTypes = (g: ReturnType<typeof buildGraph>) => g.links.map((l) => l.type).sort();

describe('buildGraph', () => {
	it('includes every entity, marking stubs, with typed and directed edges', () => {
		const g = buildGraph(entities, edges, tags, { layers: ['inspired', 'similar'] });
		expect(g.nodes.map((n) => [n.id, n.stub])).toEqual([['e1', false], ['e2', false], ['e3', false], ['e4', true]]);
		expect(g.links.map((l) => [l.source, l.target, l.type, l.directed])).toEqual([
			['e1', 'e2', 'inspired', true],
			['e2', 'e3', 'similar', false]
		]);
		expect(g).toMatchObject({ total: 4, focus: null });
	});

	it('toggles each layer independently', () => {
		expect(linkTypes(buildGraph(entities, edges, tags, { layers: ['inspired'] }))).toEqual(['inspired']);
		expect(linkTypes(buildGraph(entities, edges, tags, { layers: ['similar'] }))).toEqual(['similar']);
		expect(linkTypes(buildGraph(entities, edges, tags, { layers: [] }))).toEqual([]);
		expect(linkTypes(buildGraph(entities, edges, tags, { layers: ['genre'] }))).toEqual(['genre', 'genre', 'genre']);
		expect(buildGraph(entities, edges, tags, { layers: ['era'] }).links).toEqual([]); // 1950s has only one member
		expect(linkTypes(buildGraph(entities, edges, tags, { layers: LAYERS })).filter((t) => t === 'inspired')).toHaveLength(1);
	});

	it('clusters entities sharing a tag around one hub node', () => {
		const g = buildGraph(entities, edges, tags, { layers: ['genre'] });
		expect(g.nodes.filter((n) => n.type === 'hub')).toEqual([
			{ id: 't:genre:jazz', label: 'jazz', type: 'hub', facet: 'genre', slug: 'jazz', size: 3 }
		]);
		expect(g.links.map((l) => l.source).sort()).toEqual(['e1', 'e2', 'e3']);
	});

	it('shows suggested edges only when asked, and never rejected ones', () => {
		const g = buildGraph(entities, edges, tags, { layers: ['inspired', 'similar'], suggested: true });
		expect(g.links.map((l) => [l.edgeId, l.status])).toEqual([[10, 'accepted'], [11, 'accepted'], [12, 'suggested']]);
	});

	it('filters by tag', () => {
		const g = buildGraph(entities, edges, tags, { layers: ['era'], tag: { facet: 'era', slug: '1950s' } });
		expect(g.nodes.map((n) => n.id)).toEqual(['e1', 't:era:1950s']);
		expect(g.total).toBe(1);
	});

	it('builds an ego-graph around a focus node', () => {
		const chain = Array.from({ length: 6 }, (_, i) => ent(i + 1));
		const links = chain.slice(1).map((e, i) => edge(100 + i, 'similar', i + 1, e.id));
		const g = buildGraph(chain, links, new Map(), { layers: ['similar'], focus: 3, depth: 2 });
		expect(g.nodes.map((n) => n.entityId)).toEqual([1, 2, 3, 4, 5]);
		expect(g.links).toHaveLength(4);
		expect(g).toMatchObject({ focus: 3, total: 6 });
	});

	it('switches to a focused view around the most connected node above the limit', () => {
		const many = Array.from({ length: 10 }, (_, i) => ent(i + 1));
		const star = many.slice(1, 4).map((e, i) => edge(200 + i, 'similar', 1, e.id));
		const g = buildGraph(many, star, new Map(), { layers: ['similar'], maxFull: 5, depth: 1 });
		expect(g.focus).toBe(1);
		expect(g.nodes.map((n) => n.entityId)).toEqual([1, 2, 3, 4]);
		expect(buildGraph(many, star, new Map(), { layers: ['similar'], maxFull: 50 }).focus).toBeNull();
	});
});
