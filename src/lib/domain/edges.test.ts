import { describe, expect, it } from 'vitest';
import { canonicalEdge, groupRelations } from './edges';

describe('canonicalEdge', () => {
	it('orders similar edges and keeps inspired direction', () => {
		expect(canonicalEdge('similar', 9, 4)).toEqual({ from: 4, to: 9 });
		expect(canonicalEdge('similar', 4, 9)).toEqual({ from: 4, to: 9 });
		expect(canonicalEdge('inspired', 9, 4)).toEqual({ from: 9, to: 4 });
	});

	it('rejects self-links', () => {
		expect(canonicalEdge('inspired', 3, 3)).toBeNull();
		expect(canonicalEdge('similar', 3, 3)).toBeNull();
	});
});

describe('groupRelations', () => {
	// 1 inspired 2; 2 similar 3
	const edges = [
		{ id: 10, type: 'inspired' as const, fromId: 1, toId: 2 },
		{ id: 11, type: 'similar' as const, fromId: 2, toId: 3 }
	];

	it('reads one inspired row as "Inspired" from A and "Inspired by" from B', () => {
		expect(groupRelations(1, edges).inspired.map((e) => e.otherId)).toEqual([2]);
		expect(groupRelations(1, edges).inspiredBy).toEqual([]);
		expect(groupRelations(2, edges).inspiredBy.map((e) => [e.id, e.otherId])).toEqual([[10, 1]]);
	});

	it('shows similar from both ends', () => {
		expect(groupRelations(2, edges).similar.map((e) => e.otherId)).toEqual([3]);
		expect(groupRelations(3, edges).similar.map((e) => e.otherId)).toEqual([2]);
		expect(groupRelations(4, edges)).toEqual({ inspiredBy: [], inspired: [], similar: [] });
	});
});
