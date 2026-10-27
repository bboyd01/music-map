<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { api } from '../api';
	import type { EntitySummary, SuggestionView } from '../types';
	import Artwork from './Artwork.svelte';

	let { suggestions, viewing }: { suggestions: SuggestionView[]; /** Entity page we're on, if any. */ viewing?: number } = $props();

	const SOURCE = { wikidata: 'Wikidata', musicbrainz: 'MusicBrainz', lastfm: 'Last.fm', manual: 'You' } as const;
	let busy = $state<number | null>(null);
	let error = $state('');

	async function review(s: SuggestionView, status: 'accepted' | 'rejected', addToList = false) {
		busy = s.edgeId;
		error = '';
		try {
			await api(`/api/edges/${s.edgeId}`, { method: 'PATCH', body: { status, addToList } });
			await Promise.all([invalidate('app:suggestions'), invalidate('app:entity')]);
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = null;
		}
	}

	/** The end shown with artwork: the other entity on an entity page, otherwise the "from" side. */
	const other = (s: SuggestionView) => (s.from.id === viewing ? s.to : s.from);
	const canAdd = (s: SuggestionView) => [s.from, s.to].some((e) => e.kind !== 'artist' && !e.listed);
	const name = (e: EntitySummary) => (e.id === viewing ? 'this' : e.name);
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}
<ul class="list">
	{#each suggestions as s (s.edgeId)}
		{@const shown = other(s)}
		<li>
			<a href="/e/{shown.id}" class="who">
				<Artwork path={shown.artworkPath} name={shown.name} size={44} />
			</a>
			<div class="what">
				<p>
					<a href="/e/{s.from.id}">{name(s.from)}</a>
					{s.type === 'inspired' ? 'inspired' : 'is similar to'}
					<a href="/e/{s.to.id}">{name(s.to)}</a>
				</p>
				<span class="muted">via {SOURCE[s.source]}</span>
			</div>
			<div class="actions">
				<button class="btn small" type="button" disabled={busy === s.edgeId} aria-label="Reject" onclick={() => review(s, 'rejected')}>✕</button>
				{#if canAdd(s)}
					<button class="btn small" type="button" disabled={busy === s.edgeId} onclick={() => review(s, 'accepted', true)}>Accept & add</button>
				{/if}
				<button class="btn btn-primary small" type="button" disabled={busy === s.edgeId} aria-label="Accept" onclick={() => review(s, 'accepted')}>✓</button>
			</div>
		</li>
	{/each}
</ul>

<style>
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
	}
	.who {
		text-decoration: none;
	}
	.what {
		flex: 1 1 160px;
		min-width: 0;
	}
	.what p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.what a {
		color: inherit;
		font-weight: 600;
		text-decoration: none;
	}
	.what span {
		font-size: 0.8rem;
	}
	.actions {
		display: flex;
		gap: 6px;
		margin-left: auto;
	}
	.small {
		min-width: 44px;
		padding: 0 12px;
	}
	.error {
		color: var(--danger);
	}
</style>
