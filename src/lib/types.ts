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
}
