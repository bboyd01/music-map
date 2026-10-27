export type EntityKind = 'artist' | 'album' | 'track';
export type ListKind = 'album' | 'track';
export type ProviderName = 'apple' | 'spotify';
export const PROVIDER_LABEL: Record<ProviderName, string> = { apple: 'Apple Music', spotify: 'Spotify' };

/** Points at one item on one provider. `country` is the Apple storefront. */
export interface ProviderRef {
	provider: ProviderName;
	kind: EntityKind;
	id: string;
	country?: string;
}

interface ArtistRef {
	id?: string;
	name: string;
}

interface Base {
	provider: ProviderName;
	id: string;
	name: string;
	url?: string;
	/** Raw genre strings as the provider gives them; normalized during enrichment. */
	genres: string[];
	/** Largest useful artwork URL (~600px where the provider allows choosing). */
	artworkUrl?: string;
}

interface NormalizedArtist extends Base {
	kind: 'artist';
}

export interface NormalizedAlbum extends Base {
	kind: 'album';
	artist: ArtistRef;
	/** ISO, possibly partial: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
	releaseDate?: string;
	trackCount?: number;
	upc?: string;
}

export interface NormalizedTrack extends Base {
	kind: 'track';
	artist: ArtistRef;
	album?: { id?: string; name: string };
	releaseDate?: string;
	durationMs?: number;
	trackNumber?: number;
	discNumber?: number;
	isrc?: string;
}

export type NormalizedItem = NormalizedArtist | NormalizedAlbum | NormalizedTrack;

export interface SearchResult {
	provider: ProviderName;
	kind: ListKind;
	id: string;
	name: string;
	artistName: string;
	albumName?: string;
	releaseDate?: string;
	artworkUrl?: string;
	url?: string;
}

export interface MusicProvider {
	readonly name: ProviderName;
	/** Returns null when the provider has no such item. Throws ProviderError on other failures. */
	lookup(ref: Omit<ProviderRef, 'provider'>): Promise<NormalizedItem | null>;
	search(query: string, kind: ListKind, opts?: { limit?: number; country?: string }): Promise<SearchResult[]>;
}

export class ProviderError extends Error {
	constructor(
		message: string,
		readonly provider: ProviderName | 'musicbrainz' | 'wikidata' | 'lastfm' | 'artwork',
		readonly status?: number
	) {
		super(message);
		this.name = 'ProviderError';
	}
}
