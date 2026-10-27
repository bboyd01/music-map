import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../db/client';
import { eq } from 'drizzle-orm';
import { edges, kv } from '../db/schema';
import { setAutoTags, setManualTags } from '../enrich/tags';
import { AppleProvider } from '../providers/apple';
import { fixtureFetch, loadFixtures, type Fixture } from '../providers/fixtures';
import { SlidingWindowLimiter } from '../providers/http';
import { exportLibrary, importLibrary, parseExport, type ExportFile } from './backup';
import { updateListItem } from './list';
import { addEdge, createStub } from './relations';
import { commitAdd } from './service';

const ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music/7f/9f/d6/mzi.vtnaewef.jpg/600x600bb.jpg';
let dir: string;
beforeEach(async () => (dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-'))));
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

/** A small but complete library: list items, ratings, review, tags, stubs, edges, a rejection. */
async function library(): Promise<DB> {
	const db = openDb(':memory:');
	const fetchImpl = fixtureFetch([{ request: { url: ART }, status: 200, headers: { 'content-type': 'image/jpeg' }, body: 'jpg' } as Fixture, ...loadFixtures('apple.json')]);
	const deps = { db, artworkDir: dir, fetchImpl, providers: { apple: new AppleProvider({ fetchImpl, limiter: new SlidingWindowLimiter(100, 1) }), spotify: null } };
	const kob = await commitAdd(deps, { provider: 'apple', kind: 'album', id: '268443092', country: 'us' });
	const so = await commitAdd(deps, { provider: 'apple', kind: 'track', id: '268443097', country: 'us' });
	if (!kob.ok || !so.ok) throw new Error('add failed');
	updateListItem(db, kob.entityId, { status: 'listened', rating: 9, review: 'Modal perfection.', listenedAt: '2026-01-02' });
	setAutoTags(db, kob.entityId, 'genre', ['jazz', 'cool jazz']);
	setManualTags(db, so.entityId, 'instrument', ['trumpet']);
	const evans = createStub(db, { kind: 'artist', name: 'Bill Evans' }).entity;
	const trane = createStub(db, { kind: 'artist', name: 'John Coltrane' }).entity;
	addEdge(db, { type: 'inspired', from: evans.id, to: kob.entityId, note: 'liner notes' });
	addEdge(db, { type: 'similar', from: trane.id, to: evans.id });
	db.update(edges).set({ status: 'rejected' }).where(eq(edges.fromId, Math.min(trane.id, evans.id))).run();
	db.insert(kv).values({ key: 'rejected:inspired:artist|robert johnson>artist|bob dylan', value: 'x' }).run();
	return db;
}

/** Export with ids replaced by norm keys, so libraries can be compared across databases. */
function comparable(x: ExportFile) {
	const key = new Map(x.entities.map((e) => [e.id, `${e.kind}:${e.normKey}`]));
	const k = (id: number | null) => (id === null ? null : key.get(id));
	return {
		entities: x.entities
			.map(({ id, artistId, albumId, ...e }) => ({
				...e,
				id: k(id),
				artistId: k(artistId),
				albumId: k(albumId),
				externalIds: [...e.externalIds].sort((a, b) => a.id.localeCompare(b.id)),
				tags: [...e.tags].sort((a, b) => a.name.localeCompare(b.name))
			}))
			.sort((a, b) => a.id!.localeCompare(b.id!)),
		edges: x.edges.map((e) => ({ ...e, from: k(e.from), to: k(e.to) })).sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`)),
		rejections: [...x.rejections].sort()
	};
}

describe('export / import', () => {
	it('round-trips the library through JSON into a fresh database', async () => {
		const source = await library();
		const file = JSON.parse(JSON.stringify(exportLibrary(source)));
		expect(file.schemaVersion).toBe(1);

		const fresh = openDb(':memory:');
		const parsed = parseExport(file);
		if (!parsed.ok) throw new Error(parsed.message);
		expect(importLibrary(fresh, parsed.data, dir)).toMatchObject({ ok: true, created: file.entities.length, matched: 0 });
		expect(comparable(exportLibrary(fresh))).toEqual(comparable(file));

		const kobRow = exportLibrary(fresh).entities.find((e) => e.name === 'Kind of Blue')!;
		expect(kobRow.listItem).toMatchObject({ status: 'listened', rating: 9, review: 'Modal perfection.', listenedAt: '2026-01-02' });
		expect(kobRow.artworkPath).toMatch(/\.jpg$/); // artwork file exists in the data dir
	});

	it('is idempotent: importing twice creates nothing new', async () => {
		const file = exportLibrary(await library());
		const fresh = openDb(':memory:');
		importLibrary(fresh, file, dir);
		const before = comparable(exportLibrary(fresh));
		expect(importLibrary(fresh, file, dir)).toEqual({ ok: true, created: 0, matched: file.entities.length, edgesAdded: 0, listItemsAdded: 0 });
		expect(comparable(exportLibrary(fresh))).toEqual(before);
	});

	it('merges into an existing library, keeping local values', async () => {
		const file = exportLibrary(await library());
		const local = await library();
		const kob = exportLibrary(local).entities.find((e) => e.name === 'Kind of Blue')!;
		updateListItem(local, kob.id, { rating: 4 });
		expect(importLibrary(local, file, dir)).toMatchObject({ ok: true, created: 0, edgesAdded: 0 });
		expect(exportLibrary(local).entities.find((e) => e.id === kob.id)!.listItem!.rating).toBe(4);
	});

	it('rejects unknown versions and malformed files clearly', () => {
		expect(parseExport({ schemaVersion: 2, entities: [] })).toEqual({ ok: false, message: 'Unsupported export version 2; this app reads version 1.' });
		expect(parseExport({ hello: 'world' })).toEqual({ ok: false, message: 'Not a Music Map export (no schemaVersion).' });
		expect(parseExport(null)).toMatchObject({ ok: false });
		const bad = parseExport({ schemaVersion: 1, exportedAt: 'x', entities: [{ id: 1 }], edges: [], rejections: [] });
		expect(bad).toMatchObject({ ok: false, message: expect.stringContaining('entities.0') });
	});

	it('drops artwork references whose file is missing', async () => {
		const file = exportLibrary(await library());
		const other = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-empty-'));
		const fresh = openDb(':memory:');
		importLibrary(fresh, file, other);
		expect(exportLibrary(fresh).entities.every((e) => e.artworkPath === null)).toBe(true);
		await fs.rm(other, { recursive: true, force: true });
	});
});
