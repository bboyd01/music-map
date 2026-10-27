<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import Artwork from '#lib/components/Artwork.svelte';
	import ListItemSheet from '#lib/components/ListItemSheet.svelte';
	import Stars from '#lib/components/Stars.svelte';
	import { api } from '#lib/api.ts';
	import type { ListRow } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const query = $derived(data.query);
	const highlight = $derived(Number(page.url.searchParams.get('highlight')) || null);

	let q = $state('');
	$effect.pre(() => {
		q = data.query.q;
	});

	let sheetOpen = $state(false);
	let sheetItem = $state<ListRow | null>(null);
	let markListened = $state(false);

	function href(patch: Record<string, string | undefined>) {
		const params = new URLSearchParams(page.url.searchParams.toString());
		params.delete('highlight');
		for (const [k, v] of Object.entries(patch)) {
			if (v === undefined || v === '') params.delete(k);
			else params.set(k, v);
		}
		const s = params.toString();
		return s ? `?${s}` : '?';
	}

	function setParam(patch: Record<string, string | undefined>) {
		goto(href(patch), { replace: true, reset: false });
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onsearch() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => setParam({ q: q.trim() || undefined }), 250);
	}

	function open(item: ListRow, listen = false) {
		sheetItem = item;
		markListened = listen;
		sheetOpen = true;
	}

	const year = (d: string | null) => d?.slice(0, 4) ?? '';

	$effect(() => {
		if (highlight) document.getElementById(`item-${highlight}`)?.scrollIntoView({ block: 'center' });
	});

	/** Periods (e.g. Baroque) before decades, so the more telling era survives truncation. */
	const eraOrder = (eras: string[]) => [...eras].sort((a, b) => Number(/^\d{4}s$/.test(a)) - Number(/^\d{4}s$/.test(b)));

	const enriching = (item: ListRow) => item.enrichStatus === 'pending' || item.enrichStatus === 'running';

	// While items are enriching, poll just their status; reload the list only when one finishes.
	const pendingIds = $derived(data.items.filter(enriching).map((i) => i.id));
	let polls = $state(0);
	$effect(() => {
		const ids = pendingIds;
		if (!ids.length || polls > 70) return;
		const t = setTimeout(async () => {
			const { pending } = await api<{ pending: number[] }>(`/api/entities/status?ids=${ids.join(',')}`).catch(() => ({ pending: ids }));
			if (pending.length < ids.length) invalidate('app:list');
			polls++;
		}, 2500);
		return () => clearTimeout(t);
	});
</script>

<svelte:head>
	<title>List · Music Map</title>
</svelte:head>

<h1>List</h1>

<nav class="segmented" aria-label="Status">
	<a href={href({ status: 'to_listen', sort: undefined, minRating: undefined })} aria-current={query.status === 'to_listen' ? 'page' : undefined}>
		To Listen <span class="count">{data.counts.to_listen}</span>
	</a>
	<a href={href({ status: 'listened', sort: undefined })} aria-current={query.status === 'listened' ? 'page' : undefined}>
		Listened <span class="count">{data.counts.listened}</span>
	</a>
</nav>

<div class="filters">
	<label class="search">
		<span class="visually-hidden">Search your list</span>
		<input class="input" type="search" placeholder="Search your list" bind:value={q} oninput={onsearch} />
	</label>
	<div class="row">
		<label>
			<span class="visually-hidden">Kind</span>
			<select class="input" value={query.kind} onchange={(e) => setParam({ kind: e.currentTarget.value === 'all' ? undefined : e.currentTarget.value })}>
				<option value="all">All kinds</option>
				<option value="album">Albums</option>
				<option value="track">Tracks</option>
			</select>
		</label>
		<label>
			<span class="visually-hidden">Sort</span>
			<select class="input" value={query.sort} onchange={(e) => setParam({ sort: e.currentTarget.value === 'added' ? undefined : e.currentTarget.value })}>
				<option value="added">Recently added</option>
				{#if query.status === 'listened'}
					<option value="listened">Recently listened</option>
					<option value="rating">Highest rated</option>
				{/if}
				<option value="year">Release year</option>
			</select>
		</label>
		{#if data.options.genre.length || query.genre}
			<label>
				<span class="visually-hidden">Genre</span>
				<select class="input" value={query.genre ?? ''} onchange={(e) => setParam({ genre: e.currentTarget.value || undefined })}>
					<option value="">All genres</option>
					{#each data.options.genre as o (o.slug)}<option value={o.slug}>{o.name} ({o.count})</option>{/each}
				</select>
			</label>
		{/if}
		{#if data.options.era.length || query.era}
			<label>
				<span class="visually-hidden">Era</span>
				<select class="input" value={query.era ?? ''} onchange={(e) => setParam({ era: e.currentTarget.value || undefined })}>
					<option value="">All eras</option>
					{#each data.options.era as o (o.slug)}<option value={o.slug}>{o.name} ({o.count})</option>{/each}
				</select>
			</label>
		{/if}
		{#if query.status === 'listened'}
			<label>
				<span class="visually-hidden">Minimum rating</span>
				<select class="input" value={String(query.minRating ?? '')} onchange={(e) => setParam({ minRating: e.currentTarget.value || undefined })}>
					<option value="">Any rating</option>
					{#each [10, 8, 6, 4, 2] as r (r)}
						<option value={String(r)}>{r / 2}★{r < 10 ? '+' : ''}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>
</div>

{#if data.items.length === 0}
	<div class="empty">
		{#if query.q || query.kind !== 'all' || query.minRating !== undefined || query.genre || query.era}
			<p>Nothing matches these filters.</p>
			<a class="btn" href={href({ q: undefined, kind: undefined, minRating: undefined, genre: undefined, era: undefined })}>Clear filters</a>
		{:else if query.status === 'to_listen'}
			<p>Nothing to listen to yet.</p>
			<a class="btn btn-primary" href="/add">Add music</a>
		{:else}
			<p>Nothing marked as listened yet.</p>
		{/if}
	</div>
{:else}
	<ul class="items">
		{#each data.items as item (item.id)}
			<li id="item-{item.id}" class:highlight={item.id === highlight}>
				<button type="button" class="card" onclick={() => open(item)}>
					<Artwork path={item.artworkPath} name={item.name} size={64} />
					<span class="row-text">
						<span class="row-title">{item.name}</span>
						<span class="row-sub">{item.artistName ?? 'Unknown artist'}{item.releaseDate ? ` · ${year(item.releaseDate)}` : ''}</span>
						<span class="row-sub">
							{#if item.kind === 'track'}<span class="badge">Track</span>{item.albumName ? ` ${item.albumName}` : ''}{/if}
							{#if item.status === 'listened'}<Stars rating={item.rating} />{/if}
						</span>
						{#if item.genres.length || item.eras.length || enriching(item)}
							<span class="tagline truncate"
								>{[...item.genres.slice(0, 2), ...eraOrder(item.eras)].join(' · ')}{#if enriching(item)}<span class="enriching"
										>{item.genres.length || item.eras.length ? ' · ' : ''}Enriching…</span
									>{/if}</span
							>
						{/if}
					</span>
				</button>
				{#if item.status === 'to_listen'}
					<button type="button" class="listen" aria-label="Mark “{item.name}” listened" onclick={() => open(item, true)}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<ListItemSheet bind:open={sheetOpen} item={sheetItem} {markListened} onchange={() => invalidate('app:list')} />

<style>
	h1 {
		margin-bottom: 12px;
	}
	.filters {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 12px 0;
	}
	.row {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 8px;
	}
	.row label {
		min-width: 0;
	}
	.row select {
		min-width: 0;
		font-size: 0.9rem;
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
	}
	li.highlight {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
	}
	.card {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.tagline {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.enriching {
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.4;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.enriching {
			animation: none;
		}
	}
	.badge {
		display: inline-block;
		padding: 0 6px;
		border-radius: 6px;
		background: var(--surface-2);
		font-size: 0.75rem;
		font-weight: 600;
		vertical-align: 1px;
	}
	.listen {
		flex: none;
		width: 48px;
		height: 48px;
		margin-right: 6px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--accent);
		cursor: pointer;
	}
	.listen svg {
		width: 22px;
		height: 22px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.empty {
		margin-top: 40px;
		text-align: center;
		color: var(--muted);
	}
	@media (min-width: 768px) {
		.filters {
			flex-direction: row;
		}
		.search {
			flex: 1;
		}
	}
</style>
