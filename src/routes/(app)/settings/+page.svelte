<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '#lib/api.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let importing = $state(false);
	let importMessage = $state('');
	let importError = $state('');

	async function importFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		importMessage = importError = '';
		try {
			let body: unknown;
			try {
				body = JSON.parse(await file.text());
			} catch {
				throw new Error('That file isn’t valid JSON.');
			}
			const r = await api<{ created: number; matched: number; edgesAdded: number; listItemsAdded: number }>('/api/import', { body });
			importMessage = `Imported: ${r.created} new, ${r.matched} already here, ${r.listItemsAdded} list items and ${r.edgesAdded} links added.`;
			await invalidateAll();
		} catch (err) {
			importError = (err as Error).message;
		} finally {
			importing = false;
			input.value = '';
		}
	}
</script>

<svelte:head>
	<title>Settings · Music Map</title>
</svelte:head>

<h1>Settings</h1>

<section>
	<h2>Session</h2>
	<div class="actions">
		<form method="POST" action="/api/auth/logout">
			<button class="btn" type="submit">Log out</button>
		</form>
		<form method="POST" action="/api/auth/logout">
			<input type="hidden" name="everywhere" value="true" />
			<button class="btn btn-danger" type="submit">Log out everywhere</button>
		</form>
	</div>
</section>

<section>
	<h2>Backup</h2>
	<p class="muted">Export everything (list, ratings, reviews, tags, links) as JSON. Importing merges a file into this library and is safe to repeat.</p>
	<div class="actions">
		<a class="btn" href="/api/export" download>Export JSON</a>
		<label class="btn">
			{importing ? 'Importing…' : 'Import JSON'}
			<input class="visually-hidden" type="file" accept="application/json,.json" disabled={importing} onchange={importFile} />
		</label>
	</div>
	{#if importMessage}<p role="status">{importMessage}</p>{/if}
	{#if importError}<p class="error" role="alert">{importError}</p>{/if}
</section>

<section>
	<h2>Sources</h2>
	<ul class="sources">
		<li><span>Apple Music</span><span class="on">On</span></li>
		<li>
			<span>Spotify</span>
			{#if data.spotifyEnabled}
				<span class="on">On</span>
			{:else}
				<span class="muted">Off: set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET</span>
			{/if}
		</li>
	</ul>
</section>

<section>
	<h2>Password</h2>
	<p class="muted">
		To change the password, generate a new hash with <code>scripts/hash-password.ts</code> (see the README), set it as
		<code>APP_PASSWORD_HASH</code>, and restart the container. Then use "Log out everywhere".
	</p>
</section>

<style>
	section {
		margin-top: 24px;
	}
	h2 {
		font-size: 1.05rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}
	.sources {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}
	.sources li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 4px 12px;
		padding: 12px 14px;
	}
	.sources li + li {
		border-top: 1px solid var(--border);
	}
	.sources span:last-child {
		text-align: right;
	}
	.on {
		color: var(--accent);
		font-weight: 600;
	}
	.error {
		color: var(--danger);
	}
	label.btn:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	code {
		overflow-wrap: anywhere;
	}
</style>
