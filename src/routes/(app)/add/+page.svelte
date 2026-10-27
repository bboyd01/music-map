<script lang="ts">
	import { api } from '#lib/api.ts';
	import Artwork from '#lib/components/Artwork.svelte';

	type Kind = 'album' | 'track';
	type Ref = { provider: 'apple' | 'spotify'; kind: Kind; id: string; country?: string };
	type Result = Ref & {
		name: string;
		artistName: string;
		albumName?: string;
		releaseDate?: string;
		artworkUrl?: string;
		inLibrary: boolean;
	};
	type Added = {
		entityId: number;
		name: string;
		message: string;
		outcome: 'added' | 'promoted' | 'existing';
		artworkPath: string | null;
	};

	let input = $state('');
	let kind = $state<Kind>('album');
	let busy = $state(false);
	let errorMessage = $state('');
	let warnings = $state<string[]>([]);
	let results = $state<Result[] | null>(null);
	let lastQuery = $state('');
	let added = $state<Added | null>(null);
	let adding = $state<string | null>(null);
	let addedIds = $state<Record<string, Added>>({});
	const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

	const looksLikeLink = (s: string) => /^\s*(https?:\/\/|spotify:|[\w.-]*(apple\.com|spotify\.com|spotify\.link)\/)/i.test(s);
	const key = (r: Ref) => `${r.provider}:${r.id}`;
	const detailHref = (a: Added) => `/e/${a.entityId}`;
	const sourceLabel = { apple: 'Apple Music', spotify: 'Spotify' };

	let seq = 0;
	let searchTimer: ReturnType<typeof setTimeout>;

	async function submit(e?: SubmitEvent) {
		e?.preventDefault();
		clearTimeout(searchTimer);
		const value = input.trim();
		if (!value) return;
		const mine = ++seq;
		busy = true;
		errorMessage = '';
		warnings = [];
		added = null;
		try {
			const r = await api<
				| { type: 'item'; ref: Ref; name: string }
				| { type: 'results'; query: string; results: Result[]; warnings: string[] }
			>('/api/add/resolve', { body: { input: value, kind } });
			if (mine !== seq) return; // A newer search superseded this one.
			if (r.type === 'item') {
				results = null;
				added = await api<Added>('/api/add/commit', { body: r.ref });
				input = '';
			} else {
				results = r.results;
				warnings = r.warnings;
				lastQuery = r.query;
			}
		} catch (err) {
			if (mine === seq) errorMessage = (err as Error).message;
		} finally {
			if (mine === seq) busy = false;
		}
	}

	/** Search as you type, once typing pauses. Links wait for paste or Enter. */
	function oninput() {
		clearTimeout(searchTimer);
		const value = input.trim();
		if (value.length < 2 || looksLikeLink(value)) return;
		searchTimer = setTimeout(submit, 300);
	}

	async function addResult(r: Result) {
		adding = key(r);
		errorMessage = '';
		try {
			const a = await api<Added>('/api/add/commit', { body: { provider: r.provider, kind: r.kind, id: r.id, country: r.country } });
			addedIds[key(r)] = a;
			r.inLibrary = true;
		} catch (err) {
			errorMessage = (err as Error).message;
		} finally {
			adding = null;
		}
	}

	async function pasteFromClipboard() {
		try {
			input = (await navigator.clipboard.readText()).trim();
		} catch {
			errorMessage = 'Clipboard access was blocked. Long-press the box and choose Paste.';
			return;
		}
		if (input) submit();
	}

	function onpaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text') ?? '';
		if (!looksLikeLink(text)) return;
		e.preventDefault();
		input = text.trim();
		submit();
	}

	function setKind(k: Kind) {
		kind = k;
		if (results && lastQuery && !looksLikeLink(input)) {
			input = lastQuery;
			submit();
		}
	}
</script>

<svelte:head>
	<title>Add · Music Map</title>
</svelte:head>

<h1>Add</h1>

<form onsubmit={submit}>
	<label class="visually-hidden" for="add-input">Link or search</label>
	<div class="field">
		<input
			id="add-input"
			class="input"
			type="search"
			enterkeyhint="go"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			placeholder="Paste a link or search"
			bind:value={input}
			{oninput}
			{onpaste}
		/>
		<button class="btn btn-primary" type="submit" disabled={!input.trim()}>
			{busy ? '…' : looksLikeLink(input) ? 'Add' : 'Search'}
		</button>
	</div>
	<div class="controls">
		{#if canPaste}
			<button class="btn" type="button" onclick={pasteFromClipboard} disabled={busy}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6v3H9zM7 5.5H5.5v15h13v-15H17" /></svg>
				Paste from clipboard
			</button>
		{/if}
		<div class="segmented kind" role="radiogroup" aria-label="Search for">
			<button type="button" role="radio" aria-checked={kind === 'album'} onclick={() => setKind('album')}>Albums</button>
			<button type="button" role="radio" aria-checked={kind === 'track'} onclick={() => setKind('track')}>Tracks</button>
		</div>
	</div>
</form>

{#if errorMessage}
	<p class="notice error" role="alert">{errorMessage}</p>
{/if}

{#if added}
	<div class="notice done" role="status">
		<Artwork path={added.artworkPath} name={added.name} size={48} />
		<span>{added.message}</span>
		<a class="btn" href={detailHref(added)}>View</a>
	</div>
{/if}

{#each warnings as w (w)}
	<p class="notice muted">{w}</p>
{/each}

{#if results}
	{#if results.length === 0}
		<p class="muted empty">No {kind === 'album' ? 'albums' : 'tracks'} found for “{lastQuery}”.</p>
	{:else}
		<ul class="results" aria-label="Search results">
			{#each results as r (key(r))}
				{@const done = addedIds[key(r)]}
				<li>
					<Artwork url={r.artworkUrl} name={r.name} size={56} />
					<div class="row-text">
						<span class="row-title">{r.name}</span>
						<span class="row-sub">{r.artistName}{r.releaseDate ? ` · ${r.releaseDate.slice(0, 4)}` : ''}</span>
						<span class="row-sub">{r.albumName ? `${r.albumName} · ` : ''}{sourceLabel[r.provider]}</span>
					</div>
					{#if done}
						<a class="btn small" href={detailHref(done)}>View</a>
					{:else if r.inLibrary}
						<span class="in-list">In list</span>
					{:else}
						<button class="btn small" type="button" disabled={adding !== null} onclick={() => addResult(r)}>
							{adding === key(r) ? '…' : 'Add'}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{:else if !added && !errorMessage}
	<p class="muted hint">
		Paste an Apple Music{' '}or Spotify link to a song or album, or type to search. Pasted links are added right away.
	</p>
{/if}

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.field {
		display: flex;
		gap: 8px;
	}
	.field .btn {
		flex: none;
		min-width: 84px;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		justify-content: space-between;
	}
	.controls svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}
	.kind {
		min-width: 190px;
		flex: 1 1 190px;
		max-width: 260px;
		margin-left: auto;
	}
	.notice {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 16px 0 0;
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.notice span {
		flex: 1;
		min-width: 0;
	}
	.notice.error {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
	}
	.notice.done {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
	}
	.results {
		list-style: none;
		margin: 16px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.results li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
	}
	.small {
		flex: none;
		min-width: 64px;
		padding: 0 12px;
	}
	.in-list {
		flex: none;
		font-size: 0.85rem;
		color: var(--muted);
		padding: 0 4px;
	}
	.hint,
	.empty {
		margin-top: 24px;
	}
</style>
