import { eq } from 'drizzle-orm';
import { normKey } from '../../domain/normalize';
import type { DB } from '../db/client';
import { entities, listItems } from '../db/schema';
import type { NormalizedAlbum, NormalizedTrack } from '../providers/types';
import { ensureEntity } from './entities';

export type AddOutcome = 'added' | 'promoted' | 'existing';

export interface AddResult {
	entityId: number;
	/** Album/track entities that should get the downloaded artwork (target first). */
	artworkTargets: number[];
	outcome: AddOutcome;
	/** A new provider id was attached to an entity that already existed. */
	attachedProvider: boolean;
}

/**
 * Creates (or finds) the artist, album and track entities for a provider item, records its
 * external ids, and puts the item on the listening list. Runs in one transaction; no I/O.
 */
export function addItemToLibrary(db: DB, item: NormalizedAlbum | NormalizedTrack): AddResult {
	return db.transaction((tx) => {
		const artist = ensureEntity(tx, {
			kind: 'artist',
			name: item.artist.name,
			normKey: normKey('artist', { name: item.artist.name }),
			external: item.artist.id ? { provider: item.provider, id: item.artist.id } : undefined
		}).entity;

		let albumId: number | null = null;
		if (item.kind === 'track' && item.album) {
			albumId = ensureEntity(tx, {
				kind: 'album',
				name: item.album.name,
				normKey: normKey('album', { name: item.album.name, artistName: item.artist.name }),
				external: item.album.id ? { provider: item.provider, id: item.album.id } : undefined,
				artistId: artist.id,
				releaseDate: item.releaseDate
			}).entity.id;
		}

		const target = ensureEntity(tx, {
			kind: item.kind,
			name: item.name,
			normKey: normKey(item.kind, { name: item.name, artistName: item.artist.name, albumName: item.kind === 'track' ? item.album?.name : undefined }),
			external: { provider: item.provider, id: item.id, url: item.url },
			artistId: artist.id,
			albumId,
			releaseDate: item.releaseDate,
			durationMs: item.kind === 'track' ? item.durationMs : undefined
		});

		const listed = tx.select().from(listItems).where(eq(listItems.entityId, target.entity.id)).get();
		if (!listed) tx.insert(listItems).values({ entityId: target.entity.id, status: 'to_listen' }).run();

		const artworkTargets = [target.entity.id, ...(albumId ? [albumId] : [])].filter((id) => {
			const row = tx.select({ a: entities.artworkPath }).from(entities).where(eq(entities.id, id)).get();
			return !row?.a;
		});

		return {
			entityId: target.entity.id,
			artworkTargets,
			outcome: target.created ? 'added' : listed ? 'existing' : 'promoted',
			attachedProvider: !target.created && target.attached
		};
	});
}
