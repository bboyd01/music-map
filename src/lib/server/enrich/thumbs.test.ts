import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findThumb } from '../artwork';
import { openDb, type DB } from '../db/client';
import { entities, externalIds } from '../db/schema';
import { fixtureFetch, type Fixture } from '../providers/fixtures';
import { ProviderError, type MusicProvider } from '../providers/types';
import { ensureThumb, type EnrichDeps } from './pipeline';

const COVER = '0123456789abcdef0123456789abcdef.jpg';
const CAA = 'https://coverartarchive.org/release-group/rg-1/front-250';
const APPLE_SMALL = 'https://is1-ssl.mzstatic.com/image/thumb/kob.jpg/200x200bb.jpg';
const image = (url: string): Fixture => ({ request: { url }, status: 200, headers: { 'content-type': 'image/jpeg' }, body: 'small' });

let dir: string;
let db: DB;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbs-'));
	await fs.writeFile(path.join(dir, COVER), 'full');
	db = openDb(':memory:');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function album(ext: { provider: 'apple' | 'musicbrainz'; id: string }[]) {
	const id = db.insert(entities).values({ kind: 'album', name: 'Kind of Blue', normKey: 'album|kob', artworkPath: COVER }).returning().get().id;
	for (const x of ext) db.insert(externalIds).values({ entityId: id, provider: x.provider, externalId: x.id }).run();
	return id;
}

function deps(fixtures: Fixture[], apple?: Partial<MusicProvider>): EnrichDeps {
	return {
		db,
		mb: null,
		providers: { apple: apple as MusicProvider, spotify: null },
		artworkDir: dir,
		fetchImpl: fixtureFetch(fixtures),
		enqueue: () => {}
	};
}

describe('ensureThumb', () => {
	it('fetches the small cover from Apple by id', async () => {
		const id = album([{ provider: 'apple', id: '268443092' }]);
		const lookup = async () => ({ artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/kob.jpg/600x600bb.jpg' }) as never;
		await ensureThumb(deps([image(APPLE_SMALL)], { lookup }), id);
		expect(await findThumb(dir, COVER)).toBe('0123456789abcdef0123456789abcdef-s.jpg');
	});

	it('falls back to the Cover Art Archive when Apple has nothing', async () => {
		const id = album([
			{ provider: 'apple', id: '1' },
			{ provider: 'musicbrainz', id: 'rg-1' }
		]);
		await ensureThumb(deps([image(CAA)], { lookup: async () => null }), id);
		expect(await findThumb(dir, COVER)).toBeDefined();
	});

	it('retries only when a lookup failed, not when no source has the cover', async () => {
		const id = album([{ provider: 'musicbrainz', id: 'rg-1' }]);
		await expect(ensureThumb(deps([{ request: { url: CAA }, status: 404, headers: {}, body: '' }]), id)).resolves.toBeUndefined();

		const other = album([{ provider: 'apple', id: '2' }]);
		const lookup = async () => {
			throw new ProviderError('rate limited', 'apple', 429);
		};
		await expect(ensureThumb(deps([], { lookup }), other)).rejects.toThrow('rate limited');
	});
});
