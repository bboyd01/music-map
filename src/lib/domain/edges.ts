export type EdgeType = 'inspired' | 'similar';

/**
 * Storage form of an edge (section 6.2). `inspired` is directed: from = the influence,
 * to = the one influenced. `similar` is symmetric and stored as (min, max). Self-links are invalid.
 */
export function canonicalEdge(type: EdgeType, from: number, to: number): { from: number; to: number } | null {
	if (from === to) return null;
	return type === 'similar' ? { from: Math.min(from, to), to: Math.max(from, to) } : { from, to };
}

export interface EdgeLike {
	id: number;
	type: EdgeType;
	fromId: number;
	toId: number;
}

export interface Relations<E> {
	/** Influences of this entity. */
	inspiredBy: E[];
	/** Entities this one influenced. */
	inspired: E[];
	similar: E[];
}

/** Groups edges touching `entityId` by how they read from its side; one row serves both ends. */
export function groupRelations<E extends EdgeLike>(entityId: number, edges: E[]): Relations<E & { otherId: number }> {
	const out: Relations<E & { otherId: number }> = { inspiredBy: [], inspired: [], similar: [] };
	for (const e of edges) {
		if (e.fromId !== entityId && e.toId !== entityId) continue;
		const otherId = e.fromId === entityId ? e.toId : e.fromId;
		const group = e.type === 'similar' ? 'similar' : e.toId === entityId ? 'inspiredBy' : 'inspired';
		out[group].push({ ...e, otherId });
	}
	return out;
}
