<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { api } from '#lib/api.ts';
	import Artwork from '#lib/components/Artwork.svelte';
	import EntityPicker from '#lib/components/EntityPicker.svelte';
	import ListItemSheet from '#lib/components/ListItemSheet.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import Stars from '#lib/components/Stars.svelte';
	import SuggestionList from '#lib/components/SuggestionList.svelte';
	import TagEditor from '#lib/components/TagEditor.svelte';
	import type { EntityDetail, RelationView } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const e = $derived(data.entity);
	const refresh = () => invalidate('app:entity');

	let error = $state('');
	async function run(fn: () => Promise<unknown>) {
		error = '';
		try {
			await fn();
			await refresh();
		} catch (err) {
			error = (err as Error).message;
		}
	}

	// Listening
	let listOpen = $state(false);
	let markListened = $state(false);
	const listItem = $derived(
		e.listItem
			? { id: e.id, name: e.name, artistName: e.artist?.name ?? null, artworkPath: e.artworkPath, ...e.listItem }
			: null
	);
	function openList(listen: boolean) {
		markListened = listen;
		listOpen = true;
	}
	async function onListChange(result?: { deleted: number[] }) {
		if (result?.deleted.includes(e.id)) await goto('/list');
		else await refresh();
	}

	// Enrichment: poll while pending so tags appear without a reload.
	const enriching = $derived(e.enrichStatus === 'pending' || e.enrichStatus === 'running');
	$effect(() => {
		// Reading `e` re-arms the timer after every refresh, not just when `enriching` flips.
		if (!enriching || !e) return;
		const t = setTimeout(refresh, 2500);
		return () => clearTimeout(t);
	});

	// Relationships
	type LinkType = 'inspiredBy' | 'inspired' | 'similar';
	const GROUPS: { key: LinkType; label: string }[] = [
		{ key: 'inspiredBy', label: 'Inspired by' },
		{ key: 'inspired', label: 'Inspired' },
		{ key: 'similar', label: 'Similar' }
	];
	let linkOpen = $state(false);
	let linkType = $state<LinkType>('inspiredBy');
	function addLink(other: { id: number }) {
		const body =
			linkType === 'inspiredBy'
				? { type: 'inspired', from: other.id, to: e.id }
				: linkType === 'inspired'
					? { type: 'inspired', from: e.id, to: other.id }
					: { type: 'similar', from: e.id, to: other.id };
		linkOpen = false;
		run(() => api('/api/edges', { body }));
	}
	const removeLink = (rel: RelationView) => run(() => api(`/api/edges/${rel.edgeId}`, { method: 'DELETE' }));

	// Merge
	let mergeOpen = $state(false);
	async function mergeInto(target: { id: number; name: string }) {
		if (!confirm(`Merge “${e.name}” into “${target.name}”? This item will be removed and its links, tags and listening data moved over.`)) return;
		mergeOpen = false;
		try {
			await api(`/api/entities/${e.id}/merge`, { body: { into: target.id } });
			await goto(`/e/${target.id}`);
		} catch (err) {
			error = (err as Error).message;
		}
	}

	const LINKS: Record<string, string> = { apple: 'Apple Music', spotify: 'Spotify', musicbrainz: 'MusicBrainz' };
	const links = $derived(e.externalIds.filter((x) => x.url && LINKS[x.provider]));
	const year = $derived(e.releaseDate?.slice(0, 4));
	const childLabel = (d: EntityDetail) => (d.kind === 'artist' ? 'In your library' : 'Tracks');
</script>

<svelte:head>
	<title>{e.name} · Music Map</title>
</svelte:head>

<header>
	<Artwork path={e.artworkPath} name={e.name} size={112} />
	<div class="head">
		<span class="kind">{e.kind}{e.listItem ? '' : ' · not in list'}</span>
		<h1>{e.name}</h1>
		<p class="muted">
			{#if e.artist}<a href="/e/{e.artist.id}">{e.artist.name}</a>{/if}
			{#if e.album}{e.artist ? ' · ' : ''}<a href="/e/{e.album.id}">{e.album.name}</a>{/if}
			{#if year}{e.artist || e.album ? ' · ' : ''}{year}{/if}
		</p>
		{#if e.credit}<p class="muted credit">{e.credit}</p>{/if}
	</div>
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if e.kind !== 'artist'}
	<section class="card">
		{#if e.listItem}
			<div class="listen">
				<div>
					<strong>{e.listItem.status === 'listened' ? 'Listened' : 'To Listen'}</strong>
					{#if e.listItem.status === 'listened'}
						<Stars rating={e.listItem.rating} size={16} />
						{#if e.listItem.listenedAt}<span class="muted"> · {e.listItem.listenedAt}</span>{/if}
					{/if}
				</div>
				<div class="buttons">
					{#if e.listItem.status === 'to_listen'}
						<button class="btn btn-primary" type="button" onclick={() => openList(true)}>Mark listened</button>
					{/if}
					<button class="btn" type="button" onclick={() => openList(false)}>Edit</button>
				</div>
			</div>
			{#if e.listItem.review}<p class="review">{e.listItem.review}</p>{/if}
		{:else}
			<div class="listen">
				<span class="muted">Not on your listening list.</span>
				<button class="btn btn-primary" type="button" onclick={() => run(() => api(`/api/list/${e.id}`, { method: 'POST' }))}>
					Add to To Listen
				</button>
			</div>
		{/if}
	</section>
{/if}

{#if links.length}
	<nav class="links" aria-label="Open in">
		{#each links as l (l.provider + l.id)}
			<a class="btn" href={l.url} target="_blank" rel="noopener noreferrer">{LINKS[l.provider]}</a>
		{/each}
	</nav>
{/if}

<section>
	<div class="section-head">
		<h2>Tags</h2>
		{#if enriching}
			<span class="muted status">Fetching details…</span>
		{:else}
			<button type="button" class="link" onclick={() => run(() => api(`/api/entities/${e.id}/enrich`, { method: 'POST' }))}>
				{e.enrichStatus === 'failed' ? 'Retry details' : 'Refresh details'}
			</button>
		{/if}
	</div>
	<div class="tags">
		<TagEditor entityId={e.id} facet="genre" label="Genre" view={e.tags.genre} onchange={refresh} />
		<TagEditor entityId={e.id} facet="era" label="Era" view={e.tags.era} onchange={refresh} />
		<TagEditor entityId={e.id} facet="instrument" label="Instruments" view={e.tags.instrument} onchange={refresh} />
	</div>
</section>

<section>
	<div class="section-head">
		<h2>Relationships</h2>
		<button type="button" class="link" onclick={() => (linkOpen = true)}>+ Add link</button>
	</div>
	{#each GROUPS as g (g.key)}
		{#if e.relations[g.key].length}
			<h3>{g.label}</h3>
			<ul class="rows">
				{#each e.relations[g.key] as rel (rel.edgeId)}
					<li>
						<a href="/e/{rel.entity.id}" class="row-link">
							<Artwork path={rel.entity.artworkPath} name={rel.entity.name} size={44} />
							<span class="row-text">
								<span class="row-title">{rel.entity.name}</span>
								<span class="row-sub">
									{rel.entity.kind}{rel.entity.artistName ? ` · ${rel.entity.artistName}` : ''}{rel.entity.listed ? '' : ' · stub'}
								</span>
							</span>
						</a>
						<button type="button" class="remove" aria-label="Remove link to {rel.entity.name}" onclick={() => removeLink(rel)}>✕</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/each}
	{#if !e.relations.inspiredBy.length && !e.relations.inspired.length && !e.relations.similar.length}
		<p class="muted">No links yet. Add who inspired this, what it inspired, or what it sounds like.</p>
	{/if}
</section>

{#if data.suggestions.length}
	<section>
		<h2>Suggestions</h2>
		<SuggestionList suggestions={data.suggestions} viewing={e.id} />
	</section>
{/if}

{#if e.children.length}
	<section>
		<h2>{childLabel(e)}</h2>
		<ul class="rows">
			{#each e.children as c (c.id)}
				<li>
					<a href="/e/{c.id}" class="row-link">
						<Artwork path={c.artworkPath} name={c.name} size={44} />
						<span class="row-text">
							<span class="row-title">{c.name}</span>
							<span class="row-sub">{c.kind}{c.listed ? '' : ' · not in list'}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="more">
	<button type="button" class="link" onclick={() => (mergeOpen = true)}>Merge into…</button>
	<span class="muted">Use when the same {e.kind} was added twice.</span>
</section>

{#if listItem}
	<ListItemSheet bind:open={listOpen} item={listItem} {markListened} onchange={onListChange} />
{/if}

<Sheet bind:open={linkOpen} title="Add link">
	<div class="segmented" role="radiogroup" aria-label="Link type">
		{#each GROUPS as g (g.key)}
			<button type="button" role="radio" aria-checked={linkType === g.key} onclick={() => (linkType = g.key)}>{g.label}</button>
		{/each}
	</div>
	<p class="muted hint">
		{linkType === 'inspiredBy' ? `Pick what inspired “${e.name}”.` : linkType === 'inspired' ? `Pick what “${e.name}” inspired.` : `Pick something similar to “${e.name}”.`}
	</p>
	<EntityPicker excludeId={e.id} onpick={addLink} />
</Sheet>

<Sheet bind:open={mergeOpen} title="Merge “{e.name}” into…">
	<p class="muted hint">Pick the {e.kind} to keep.</p>
	<EntityPicker kind={e.kind} excludeId={e.id} allowCreate={false} onpick={mergeInto} />
</Sheet>

<style>
	header {
		display: flex;
		gap: 16px;
		align-items: flex-end;
		margin-bottom: 16px;
	}
	.head {
		min-width: 0;
	}
	.kind {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	h1 {
		margin: 2px 0 4px;
		font-size: 1.5rem;
		overflow-wrap: anywhere;
	}
	.head p {
		margin: 0;
	}
	.credit {
		font-size: 0.9rem;
	}
	section {
		margin-top: 24px;
	}
	.card {
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}
	.listen {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
	}
	.buttons {
		display: flex;
		gap: 8px;
	}
	.review {
		margin: 10px 0 0;
		white-space: pre-line;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
	}
	.section-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	h2 {
		font-size: 1.1rem;
	}
	h3 {
		margin: 12px 0 4px;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.tags {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.status {
		font-size: 0.85rem;
	}
	.link {
		min-height: 44px;
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		font-weight: 600;
		cursor: pointer;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		display: flex;
		align-items: center;
		border-bottom: 1px solid var(--border);
	}
	.row-link {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 0;
		color: inherit;
		text-decoration: none;
	}
	.remove {
		flex: none;
		width: 44px;
		height: 44px;
		border: none;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.more {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 12px;
		margin-bottom: 24px;
	}
	.more span {
		font-size: 0.85rem;
	}
	.hint {
		margin: 10px 0;
	}
	.error {
		color: var(--danger);
	}
</style>
