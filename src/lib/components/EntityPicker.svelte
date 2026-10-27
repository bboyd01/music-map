<script lang="ts">
	import { api } from '../api';
	import type { EntitySummary } from '../types';
	import Artwork from './Artwork.svelte';

	type Kind = EntitySummary['kind'];
	let {
		kind,
		excludeId,
		allowCreate = true,
		onpick
	}: {
		/** Restrict to one kind (e.g. for merging). */
		kind?: Kind;
		excludeId?: number;
		allowCreate?: boolean;
		onpick: (picked: { id: number; name: string }) => void;
	} = $props();

	let q = $state('');
	let results = $state<EntitySummary[]>([]);
	let searched = $state(false);
	let newKind = $state<Kind>('artist');
	let newArtist = $state('');
	let busy = $state(false);
	let error = $state('');
	const KINDS: Kind[] = ['artist', 'album', 'track'];

	let timer: ReturnType<typeof setTimeout>;
	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const term = q.trim();
			if (!term) return void ((results = []), (searched = false));
			const params = new URLSearchParams({ q: term, ...(kind ? { kind } : {}) });
			const res = await api<{ results: EntitySummary[] }>(`/api/search?${params}`).catch(() => null);
			if (res && q.trim() === term) {
				results = res.results.filter((r) => r.id !== excludeId);
				searched = true;
			}
		}, 200);
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			const { entity } = await api<{ entity: { id: number; name: string } }>('/api/entities', {
				body: { kind: kind ?? newKind, name: q.trim(), artistName: newArtist.trim() || undefined }
			});
			onpick(entity);
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="picker">
	<label class="visually-hidden" for="picker-q">Search your library</label>
	<!-- svelte-ignore a11y_autofocus -->
	<input id="picker-q" class="input" type="search" placeholder="Search your library" autocomplete="off" autofocus bind:value={q} {oninput} />

	{#if results.length}
		<ul class="results">
			{#each results as r (r.id)}
				<li>
					<button type="button" onclick={() => onpick(r)}>
						<Artwork path={r.artworkPath} name={r.name} size={40} />
						<span class="row-text">
							<span class="row-title">{r.name}</span>
							<span class="row-sub">{r.kind}{r.artistName ? ` · ${r.artistName}` : ''}{r.listed ? '' : ' · not in list'}</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if searched}
		<p class="muted">Nothing in your library matches “{q.trim()}”.</p>
	{/if}

	{#if allowCreate && q.trim()}
		<form class="create" onsubmit={create}>
			<p class="muted">Not here? Add “{q.trim()}” as a new {kind ?? 'item'} (it won't go on your list):</p>
			{#if !kind}
				<div class="segmented" role="radiogroup" aria-label="Kind">
					{#each KINDS as k (k)}
						<button type="button" role="radio" aria-checked={newKind === k} onclick={() => (newKind = k)}>{k}</button>
					{/each}
				</div>
			{/if}
			{#if (kind ?? newKind) !== 'artist'}
				<input class="input" placeholder="Artist (optional)" bind:value={newArtist} autocomplete="off" />
			{/if}
			<button class="btn" type="submit" disabled={busy}>{busy ? 'Adding…' : `Add “${q.trim()}”`}</button>
		</form>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.picker,
	.create {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.results {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.results button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 52px;
		padding: 6px 0;
		border: none;
		border-bottom: 1px solid var(--border);
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.create {
		padding-top: 6px;
	}
	.create p {
		margin: 0;
		font-size: 0.9rem;
	}
	.segmented button {
		text-transform: capitalize;
	}
	.error {
		margin: 0;
		color: var(--danger);
	}
</style>
