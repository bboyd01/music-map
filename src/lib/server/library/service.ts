import { eq, inArray } from 'drizzle-orm';
import { normKey } from '../../domain/normalize';
import { downloadArtwork } from '../artwork';
import type { DB } from '../db/client';
import { entities, externalIds, listItems } from '../db/schema';
import type { FetchFn } from '../providers/http';
import { resolveInput, type Providers } from '../providers/resolve';
import { ProviderError, type ListKind, type ProviderName, type ProviderRef, type SearchResult } from '../providers/types';
import { addItemToLibrary, type AddOutcome } from './add';

export interface LibraryDeps {
	db: DB;
	providers: Providers;
	artworkDir: string;
	fetchImpl?: FetchFn;
	log?: (msg: string) => void;
}

const LABEL: Record<ProviderName, string> = { apple: 'Apple Music', spotify: 'Spotify' };

export type ResolveResponse =
	| { type: 'item'; ref: ProviderRef & { kind: ListKind }; name: string; artistName: string }
	| { type: 'results'; query: string; kind: ListKind; results: (SearchResult & { inLibrary: boolean })[]; warnings: string[] }
	| { type: 'error'; message: string };

/** Paste box handler: links resolve to one item; text runs a search across providers. */
export async function resolveForAdd(deps: LibraryDeps, input: string, kind: ListKind): Promise<ResolveResponse> {
	const r = await resolveInput(input, deps.providers, { fetchImpl: deps.fetchImpl });
	if (r.type === 'error') return r;
	if (r.type === 'text') return searchProviders(deps, r.query, kind);
	if (r.item.kind === 'artist') {
		return {
			type: 'error',
			message: `${r.item.name} is an artist. Only albums and tracks go on the list. Search for one of their albums instead.`
		};
	}
	return {
		type: 'item',
		ref: { ...r.ref, kind: r.item.kind },
		name: r.item.name,
		artistName: r.item.artist.name
	};
}

/** Searches Apple (always) and Spotify (if configured) in parallel; Spotify duplicates of Apple results are dropped. */
export async function searchProviders(deps: LibraryDeps, query: string, kind: ListKind): Promise<ResolveResponse> {
	const active = [deps.providers.apple, deps.providers.spotify].filter((p) => p !== null);
	const settled = await Promise.allSettled(active.map((p) => p.search(query, kind)));
	const warnings: string[] = [];
	const seen = new Set<string>();
	const results: SearchResult[] = [];
	settled.forEach((s, i) => {
		const name = active[i].name;
		if (s.status === 'rejected') {
			deps.log?.(`search ${name} failed: ${s.reason}`);
			warnings.push(`${LABEL[name]} search failed.`);
			return;
		}
		for (const r of s.value) {
			const key = normKey(kind, { name: r.name, artistName: r.artistName, albumName: r.albumName });
			if (seen.has(key)) continue;
			seen.add(key);
			results.push(r);
		}
	});
	if (warnings.length === active.length) return { type: 'error', message: 'Search is unavailable right now. Try again in a moment.' };

	const listed = listedExternalIds(deps.db, results);
	return {
		type: 'results',
		query,
		kind,
		warnings,
		results: results.map((r) => ({ ...r, inLibrary: listed.has(`${r.provider}:${r.id}`) }))
	};
}

/** `provider:id` of results already on the listening list. */
function listedExternalIds(db: DB, results: SearchResult[]): Set<string> {
	const ids = results.map((r) => r.id);
	if (!ids.length) return new Set();
	const rows = db
		.select({ provider: externalIds.provider, id: externalIds.externalId })
		.from(externalIds)
		.innerJoin(listItems, eq(listItems.entityId, externalIds.entityId))
		.where(inArray(externalIds.externalId, ids))
		.all();
	return new Set(rows.map((r) => `${r.provider}:${r.id}`));
}

export type CommitResult =
	| {
			ok: true;
			entityId: number;
			outcome: AddOutcome;
			attachedProvider: boolean;
			name: string;
			message: string;
			listStatus: 'to_listen' | 'listened';
			artworkPath: string | null;
		}
	| { ok: false; status: number; message: string };

/**
 * Looks the item up, adds it (deduped) to the library and list, then downloads artwork.
 * Artwork failure never fails the add.
 */
export async function commitAdd(deps: LibraryDeps, ref: ProviderRef & { kind: ListKind }): Promise<CommitResult> {
	const provider = ref.provider === 'apple' ? deps.providers.apple : deps.providers.spotify;
	if (!provider) return { ok: false, status: 400, message: `${LABEL[ref.provider]} isn't set up on this server.` };

	let item;
	try {
		item = await provider.lookup(ref);
	} catch (err) {
		if (!(err instanceof ProviderError)) throw err;
		deps.log?.(`lookup failed: ${err.message}`);
		return { ok: false, status: 502, message: `${LABEL[ref.provider]} didn't respond. Try again in a moment.` };
	}
	if (!item || item.kind === 'artist') {
		return { ok: false, status: 404, message: `Couldn't find that ${ref.kind} on ${LABEL[ref.provider]}.` };
	}

	const result = addItemToLibrary(deps.db, item);

	if (item.artworkUrl && result.artworkTargets.length) {
		try {
			const file = await downloadArtwork(item.artworkUrl, deps.artworkDir, { fetchImpl: deps.fetchImpl });
			deps.db
				.update(entities)
				.set({ artworkPath: file })
				.where(inArray(entities.id, result.artworkTargets))
				.run();
		} catch (err) {
			deps.log?.(`artwork failed for entity ${result.entityId}: ${err}`);
		}
	}

	const listStatus =
		deps.db.select({ s: listItems.status }).from(listItems).where(eq(listItems.entityId, result.entityId)).get()?.s ?? 'to_listen';
	const artworkPath =
		deps.db.select({ a: entities.artworkPath }).from(entities).where(eq(entities.id, result.entityId)).get()?.a ?? null;

	const message = {
		added: `Added ${item.name} to To Listen.`,
		promoted: `Added ${item.name} to To Listen.`,
		existing: `${item.name} is already in your list${listStatus === 'listened' ? ' (Listened)' : ''}.`
	}[result.outcome];
	const { artworkTargets: _, ...rest } = result;
	return { ok: true, ...rest, name: item.name, message, listStatus, artworkPath };
}
