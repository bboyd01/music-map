/** Shared between server and client. */

export interface ListRow {
	id: number;
	kind: 'album' | 'track';
	name: string;
	artistName: string | null;
	albumName: string | null;
	releaseDate: string | null;
	artworkPath: string | null;
	enrichStatus: string;
	status: 'to_listen' | 'listened';
	rating: number | null;
	review: string | null;
	addedAt: string;
	listenedAt: string | null;
	/** Effective (possibly inherited) tag names. */
	genres: string[];
	eras: string[];
}

export type Facet = 'genre' | 'era' | 'instrument';

export interface TagChip {
	name: string;
	slug: string;
	source: 'auto' | 'manual';
}

export interface FacetView {
	tags: TagChip[];
	inheritedFrom: { entityId: number; kind: 'artist' | 'album' | 'track'; name: string } | null;
}

export interface EntityView {
	id: number;
	kind: 'artist' | 'album' | 'track';
	name: string;
	credit: string | null;
	releaseDate: string | null;
	artworkPath: string | null;
	enrichStatus: 'pending' | 'running' | 'done' | 'failed';
	artist: { id: number; name: string } | null;
	album: { id: number; name: string } | null;
	externalIds: { provider: string; id: string; url: string | null }[];
	tags: Record<Facet, FacetView>;
}

export interface FacetOption {
	slug: string;
	name: string;
	count: number;
}
