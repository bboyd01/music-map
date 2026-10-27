<script lang="ts">
	import Artwork from './Artwork.svelte';
	import Sheet from './Sheet.svelte';
	import StarInput from './StarInput.svelte';
	import { api } from '../api';
	import type { ListRow } from '../types';

	type Item = Pick<ListRow, 'id' | 'name' | 'artistName' | 'artworkPath' | 'status' | 'rating' | 'review' | 'listenedAt'>;

	let {
		open = $bindable(false),
		item,
		markListened = false,
		onchange
	}: {
		open: boolean;
		item: Item | null;
		markListened?: boolean;
		/** `deleted` lists entities removed along with the list item (stubs nothing else needs). */
		onchange: (result?: { deleted: number[] }) => void;
	} = $props();

	const localToday = () => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};

	let status = $state<'to_listen' | 'listened'>('to_listen');
	let rating = $state<number | null>(null);
	let review = $state('');
	let listenedAt = $state('');
	let saving = $state(false);
	let errorMessage = $state('');
	// Reset the form whenever a different item (or mode) is opened.
	$effect(() => {
		if (!open || !item) return;
		status = markListened ? 'listened' : item.status;
		rating = item.rating;
		review = item.review ?? '';
		listenedAt = item.listenedAt ?? (markListened ? localToday() : '');
		errorMessage = '';
	});

	async function request(method: string, body?: unknown) {
		saving = true;
		errorMessage = '';
		try {
			const res = await api<{ deletedEntities?: number[] }>(`/api/list/${item!.id}`, { method, body });
			open = false;
			onchange({ deleted: res.deletedEntities ?? [] });
		} catch (err) {
			errorMessage = (err as Error).message;
		} finally {
			saving = false;
		}
	}

	function save(e: SubmitEvent) {
		e.preventDefault();
		request('PATCH', {
			status,
			rating,
			review: review.trim() ? review : null,
			listenedAt: status === 'listened' ? listenedAt || localToday() : listenedAt || null
		});
	}

	function remove() {
		if (confirm(`Remove “${item!.name}” from your list?`)) request('DELETE');
	}
</script>

<Sheet bind:open title={markListened ? 'Mark listened' : 'Edit'}>
	{#if item}
		<form onsubmit={save}>
			<div class="head">
				<Artwork path={item.artworkPath} name={item.name} size={56} />
				<div class="meta">
					<strong>{item.name}</strong>
					<span class="muted">{item.artistName ?? ''}</span>
				</div>
			</div>

			<div class="segmented" role="radiogroup" aria-label="Status">
				<button type="button" role="radio" aria-checked={status === 'to_listen'} onclick={() => (status = 'to_listen')}>To Listen</button>
				<button
					type="button"
					role="radio"
					aria-checked={status === 'listened'}
					onclick={() => {
						status = 'listened';
						listenedAt ||= localToday();
					}}>Library</button
				>
			</div>

			{#if status === 'listened'}
				<fieldset>
					<legend>Rating</legend>
					<StarInput bind:value={rating} />
				</fieldset>
				<label>
					<span>Listened on</span>
					<input class="input" type="date" bind:value={listenedAt} max={localToday()} />
				</label>
			{/if}

			<label>
				<span>Review</span>
				<textarea class="input" rows="5" bind:value={review} placeholder="What did you think?"></textarea>
			</label>

			{#if errorMessage}<p class="error" role="alert">{errorMessage}</p>{/if}

			<div class="actions">
				<!-- svelte-ignore a11y_autofocus -- Enter should save, not hit the close button. -->
				<button class="btn btn-primary" type="submit" disabled={saving} autofocus>{saving ? 'Saving…' : 'Save'}</button>
				{#if !markListened}
					<button class="btn btn-danger" type="button" disabled={saving} onclick={remove}>Remove</button>
				{/if}
			</div>
		</form>

	{/if}
</Sheet>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.head {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.meta strong,
	.meta span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	fieldset {
		border: none;
		margin: 0;
		padding: 0;
	}
	legend,
	label > span {
		display: block;
		margin-bottom: 6px;
		font-size: 0.9rem;
		color: var(--muted);
	}
	textarea.input {
		padding: 10px 12px;
		resize: vertical;
		min-height: 110px;
	}
	.actions {
		display: flex;
		gap: 12px;
	}
	.actions .btn-primary {
		flex: 1;
	}
	.error {
		margin: 0;
		color: var(--danger);
	}
</style>
