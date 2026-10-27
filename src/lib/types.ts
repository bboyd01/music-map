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

import type { Facet } from './domain/tags';

export type { Facet };

interface TagChip {
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
	/** Co-credited artists beyond the primary one. */
	coArtists: { id: number; name: string }[];
	album: { id: number; name: string } | null;
	externalIds: { provider: string; id: string; url: string | null }[];
	tags: Record<Facet, FacetView>;
}

export interface EntitySummary {
	id: number;
	kind: 'artist' | 'album' | 'track';
	name: string;
	artistName: string | null;
	artworkPath: string | null;
	listed: boolean;
}

export interface RelationView {
	edgeId: number;
	note: string | null;
	source: 'manual' | 'musicbrainz' | 'wikidata' | 'lastfm';
	entity: EntitySummary;
}

export interface EntityDetail extends EntityView {
	listItem: Pick<ListRow, 'status' | 'rating' | 'review' | 'addedAt' | 'listenedAt'> | null;
	relations: { inspiredBy: RelationView[]; inspired: RelationView[]; similar: RelationView[] };
	/** An artist's albums/tracks, or an album's tracks, that are in the library. */
	children: EntitySummary[];
}

export interface FacetOption {
	slug: string;
	name: string;
	count: number;
}

export interface SuggestionView {
	edgeId: number;
	type: 'inspired' | 'similar';
	source: RelationView['source'];
	createdAt: string;
	from: EntitySummary;
	to: EntitySummary;
}
