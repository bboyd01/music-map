import type { Facet } from './tags';

export type Layer = 'inspired' | 'similar' | Facet;
export const LAYERS: Layer[] = ['inspired', 'similar', 'genre', 'era', 'instrument'];
const FACET_LAYERS = new Set<Layer>(['genre', 'era', 'instrument']);

export interface GraphEntity {
	id: number;
	name: string;
	kind: 'artist' | 'album' | 'track';
	artistName: string | null;
	artworkPath: string | null;
	/** Has a listening-list item; otherwise it's a stub. */
	listed: boolean;
}

export interface StoredEdge {
	id: number;
	type: 'inspired' | 'similar';
	fromId: number;
	toId: number;
	status: 'accepted' | 'suggested' | 'rejected';
}

export type EffectiveTagMap = Map<number, Partial<Record<Facet, { name: string; slug: string }[]>>>;

export interface GraphNode {
	id: string;
	label: string;
	type: 'entity' | 'hub';
	entityId?: number;
	kind?: GraphEntity['kind'];
	stub?: boolean;
	artistName?: string | null;
	artworkPath?: string | null;
	facet?: Facet;
	slug?: string;
	/** Hubs: how many entities share the tag. */
	size?: number;
}

export interface GraphLink {
	id: string;
	source: string;
	target: string;
	type: Layer;
	directed: boolean;
	status: 'accepted' | 'suggested';
	edgeId?: number;
}

export interface GraphOptions {
	layers: Layer[];
	suggested?: boolean;
	/** Only entities whose effective tags include this one. */
	tag?: { facet: Facet; slug: string };
	focus?: number;
	depth?: number;
	/** Above this many entities, an ego-graph around a focus node is shown instead. */
	maxFull?: number;
}

export interface Graph {
	nodes: GraphNode[];
	links: GraphLink[];
	/** Entity count before focusing. */
	total: number;
	focus: number | null;
}

const entityNodeId = (id: number) => `e${id}`;
const hubId = (facet: Facet, slug: string) => `t:${facet}:${slug}`;

/** Builds the map for one kind of entity (section 10). Pure. */
export function buildGraph(
	entities: GraphEntity[],
	edges: StoredEdge[],
	tags: EffectiveTagMap,
	opts: GraphOptions
): Graph {
	const layers = new Set(opts.layers);
	const visible = opts.tag
		? entities.filter((e) => tags.get(e.id)?.[opts.tag!.facet]?.some((t) => t.slug === opts.tag!.slug))
		: entities;
	const ids = new Set(visible.map((e) => e.id));

	const nodes: GraphNode[] = visible.map((e) => ({
		id: entityNodeId(e.id),
		label: e.name,
		type: 'entity',
		entityId: e.id,
		kind: e.kind,
		stub: !e.listed,
		artistName: e.artistName,
		artworkPath: e.artworkPath
	}));

	const links: GraphLink[] = [];
	for (const e of edges) {
		if (!layers.has(e.type) || !ids.has(e.fromId) || !ids.has(e.toId)) continue;
		if (e.status === 'rejected' || (e.status === 'suggested' && !opts.suggested)) continue;
		links.push({
			id: `x${e.id}`,
			source: entityNodeId(e.fromId),
			target: entityNodeId(e.toId),
			type: e.type,
			directed: e.type === 'inspired',
			status: e.status,
			edgeId: e.id
		});
	}

	// Facet layers: shared tags become hub nodes (only tags shared by 2+ entities, plus the filter tag).
	for (const layer of layers) {
		if (!FACET_LAYERS.has(layer)) continue;
		const facet = layer as Facet;
		const members = new Map<string, { name: string; ids: number[] }>();
		for (const e of visible) {
			for (const t of tags.get(e.id)?.[facet] ?? []) {
				const m = members.get(t.slug) ?? { name: t.name, ids: [] };
				m.ids.push(e.id);
				members.set(t.slug, m);
			}
		}
		for (const [slug, m] of members) {
			const isFilter = opts.tag?.facet === facet && opts.tag.slug === slug;
			if (m.ids.length < 2 && !isFilter) continue;
			const hub = hubId(facet, slug);
			nodes.push({ id: hub, label: m.name, type: 'hub', facet, slug, size: m.ids.length });
			for (const id of m.ids) {
				links.push({ id: `${hub}>${id}`, source: entityNodeId(id), target: hub, type: facet, directed: false, status: 'accepted' });
			}
		}
	}

	const total = visible.length;
	const wantsFocus = opts.focus !== undefined && ids.has(opts.focus);
	if (!wantsFocus && total <= (opts.maxFull ?? 300)) return { nodes, links, total, focus: null };

	const focus = wantsFocus ? opts.focus! : mostConnected(nodes, links);
	if (focus === null) return { nodes, links, total, focus: null };
	return { ...egoGraph(nodes, links, entityNodeId(focus), opts.depth ?? 2), total, focus };
}

/** Entity with the most links (ties: lowest id), used as the default focus for large maps. */
function mostConnected(nodes: GraphNode[], links: GraphLink[]): number | null {
	const degree = new Map<string, number>();
	for (const l of links) for (const end of [l.source, l.target]) degree.set(end, (degree.get(end) ?? 0) + 1);
	let best: GraphNode | undefined;
	for (const n of nodes) {
		if (n.type !== 'entity') continue;
		if (!best || (degree.get(n.id) ?? 0) > (degree.get(best.id) ?? 0)) best = n;
	}
	return best?.entityId ?? null;
}

/** Nodes within `depth` hops of `focusId` (a hub counts as a hop), and the links among them. */
export function egoGraph(nodes: GraphNode[], links: GraphLink[], focusId: string, depth: number) {
	const adjacent = new Map<string, string[]>();
	const connect = (a: string, b: string) => {
		const list = adjacent.get(a);
		if (list) list.push(b);
		else adjacent.set(a, [b]);
	};
	for (const l of links) {
		connect(l.source, l.target);
		connect(l.target, l.source);
	}
	const keep = new Set([focusId]);
	let frontier = [focusId];
	for (let d = 0; d < depth && frontier.length; d++) {
		const next: string[] = [];
		for (const id of frontier) {
			for (const n of adjacent.get(id) ?? []) {
				if (!keep.has(n)) {
					keep.add(n);
					next.push(n);
				}
			}
		}
		frontier = next;
	}
	return {
		nodes: nodes.filter((n) => keep.has(n.id)),
		links: links.filter((l) => keep.has(l.source) && keep.has(l.target))
	};
}
