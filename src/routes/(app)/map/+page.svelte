<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Artwork from '#lib/components/Artwork.svelte';
	import GraphView from '#lib/components/GraphView.svelte';
	import { LAYERS, type GraphNode, type Layer } from '#lib/domain/graph.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const q = $derived(data.query);
	const g = $derived(data.graph);

	const KINDS = [
		{ value: 'artist', label: 'Artists' },
		{ value: 'album', label: 'Albums' },
		{ value: 'track', label: 'Tracks' }
	] as const;
	const LAYER_LABEL: Record<Layer, string> = { inspired: 'Inspired', similar: 'Similar', genre: 'Genre', era: 'Era', instrument: 'Instrument' };

	let selected = $state<GraphNode | null>(null);

	function set(patch: Record<string, string | undefined>) {
		const params = new URLSearchParams(page.url.searchParams.toString());
		for (const [k, v] of Object.entries(patch)) {
			if (v === undefined) params.delete(k);
			else params.set(k, v);
		}
		selected = null;
		goto(`?${params}`, { replace: true, reset: false });
	}

	function toggleLayer(layer: Layer) {
		const next = q.layers.includes(layer) ? q.layers.filter((l) => l !== layer) : [...q.layers, layer];
		set({ layers: LAYERS.filter((l) => next.includes(l)).join(',') });
	}

	const tagLabel = $derived(q.tag ? `${q.tag.facet}: ${q.tag.slug.replace(/-/g, ' ')}` : '');
</script>

<svelte:head>
	<title>Map · Music Map</title>
</svelte:head>

<div class="map">
	{#if g.nodes.length}
		<GraphView graph={g} focus={g.focus} onselect={(n) => (selected = n)} />
	{:else}
		<div class="empty">
			{#if q.tag}
				<p>Nothing tagged {tagLabel}.</p>
				<button class="btn" type="button" onclick={() => set({ tag: undefined })}>Clear filter</button>
			{:else}
				<p>No {q.kind}s yet. Add music or link some {q.kind}s to see them here.</p>
				<a class="btn btn-primary" href="/add">Add music</a>
			{/if}
		</div>
	{/if}

	<div class="bar">
		<nav class="segmented" aria-label="Show">
			{#each KINDS as k (k.value)}
				<button type="button" aria-pressed={q.kind === k.value} onclick={() => set({ kind: k.value, focus: undefined })}>{k.label}</button>
			{/each}
		</nav>
		<div class="chips" role="group" aria-label="Layers">
			{#each LAYERS as layer (layer)}
				<button type="button" class="chip {layer}" aria-pressed={q.layers.includes(layer)} onclick={() => toggleLayer(layer)}>
					{LAYER_LABEL[layer]}
				</button>
			{/each}
			<button type="button" class="chip" aria-pressed={q.suggested} onclick={() => set({ suggested: q.suggested ? undefined : '1' })}>
				Suggested
			</button>
		</div>
		<div class="status">
			{#if g.focus !== null}
				<span>Around <strong>{g.nodes.find((n) => n.entityId === g.focus)?.label}</strong></span>
				<span class="depth" role="group" aria-label="Depth">
					{#each [1, 2, 3] as d (d)}
						<button type="button" aria-pressed={q.depth === d} onclick={() => set({ depth: String(d), focus: String(g.focus) })}>{d}</button>
					{/each}
				</span>
				{#if g.total <= 300 || q.focus}
					<button type="button" class="link" onclick={() => set({ focus: undefined, depth: undefined })}>Show all</button>
				{/if}
			{:else}
				<span>{g.total} {q.kind}{g.total === 1 ? '' : 's'}</span>
			{/if}
			{#if q.tag}
				<button type="button" class="filter" onclick={() => set({ tag: undefined })} aria-label="Clear filter {tagLabel}">{tagLabel} ✕</button>
			{/if}
		</div>
	</div>

	{#if selected}
		<aside class="preview" aria-label="Selected">
			{#if selected.type === 'entity'}
				<Artwork path={selected.artworkPath} name={selected.label} size={52} />
				<div class="row-text">
					<span class="row-title">{selected.label}</span>
					<span class="row-sub">{selected.artistName ?? selected.kind}{selected.stub ? ' · not in list' : ''}</span>
				</div>
				<div class="actions">
					<button class="btn" type="button" onclick={() => set({ focus: String(selected!.entityId) })}>Focus</button>
					<a class="btn btn-primary" href="/e/{selected.entityId}">Open</a>
				</div>
			{:else}
				<div class="row-text">
					<span class="row-title">{selected.label}</span>
					<span class="row-sub">{selected.facet} · {selected.size} {q.kind}s</span>
				</div>
				<div class="actions">
					<button class="btn btn-primary" type="button" onclick={() => set({ tag: `${selected!.facet}:${selected!.slug}`, focus: undefined })}>
						Only these
					</button>
				</div>
			{/if}
			<button type="button" class="close" aria-label="Close" onclick={() => (selected = null)}>✕</button>
		</aside>
	{/if}
</div>

<style>
	.map {
		position: fixed;
		inset: 0 0 calc(var(--tabbar-h) + var(--safe-bottom)) 0;
		background: var(--bg);
		overflow: hidden;
	}
	@media (min-width: 768px) {
		.map {
			inset: 0 0 0 calc(var(--rail-w) + var(--safe-left));
		}
	}
	.bar {
		position: absolute;
		z-index: 2;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: calc(10px + var(--safe-top)) calc(12px + var(--safe-right)) 10px calc(12px + var(--safe-left));
		background: linear-gradient(var(--bg) 70%, transparent);
		pointer-events: none;
	}
	.bar > * {
		pointer-events: auto;
	}
	.segmented {
		max-width: 420px;
	}
	.chips {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.chip {
		flex: none;
		min-height: 36px;
		padding: 0 12px;
		border-radius: 18px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--muted);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.chip[aria-pressed='true'] {
		color: var(--accent-text);
		background: var(--accent);
		border-color: var(--accent);
	}
	.chip.genre[aria-pressed='true'] {
		background: #7c3aed;
		border-color: #7c3aed;
		color: #fff;
	}
	.chip.era[aria-pressed='true'] {
		background: #0e7490;
		border-color: #0e7490;
		color: #fff;
	}
	.chip.instrument[aria-pressed='true'] {
		background: #b45309;
		border-color: #b45309;
		color: #fff;
	}
	.status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 12px;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.depth {
		display: inline-flex;
		gap: 4px;
	}
	.depth button,
	.filter,
	.link {
		min-height: 32px;
		min-width: 32px;
		border-radius: 16px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 0.85rem;
		cursor: pointer;
	}
	.depth button[aria-pressed='true'] {
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 700;
	}
	.filter {
		padding: 0 10px;
		border-color: var(--accent);
		color: var(--accent);
	}
	.link {
		border: none;
		background: none;
		color: var(--accent);
		font-weight: 600;
	}
	.preview {
		position: absolute;
		z-index: 3;
		left: 12px;
		right: 12px;
		bottom: 12px;
		max-width: 520px;
		margin: 0 auto;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 12px;
		padding: 12px 44px 12px 12px;
		border-radius: 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
	}
	.preview .row-text {
		flex: 1 1 140px;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-left: auto;
	}
	.close {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 40px;
		height: 40px;
		border: none;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 24px;
		text-align: center;
		color: var(--muted);
	}
</style>
