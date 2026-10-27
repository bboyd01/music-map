<script lang="ts">
	import { api } from '../api';
	import type { EntityView, Facet, FacetView } from '../types';

	let {
		entityId,
		facet,
		label,
		view,
		onchange
	}: { entityId: number; facet: Facet; label: string; view: FacetView; onchange: (e: EntityView) => void } = $props();

	let adding = $state(false);
	let text = $state('');
	let suggestions = $state<{ name: string }[]>([]);
	let busy = $state(false);
	let error = $state('');
	let input: HTMLInputElement | undefined = $state();
	const listId = $derived(`tags-${facet}-${entityId}`);
	const inherited = $derived(view.inheritedFrom !== null);
	const names = $derived(view.tags.map((t) => t.name));

	async function save(next: string[]) {
		busy = true;
		error = '';
		try {
			const res = await api<{ entity: EntityView }>(`/api/entities/${entityId}`, {
				method: 'PATCH',
				body: { tags: { [facet]: next } }
			});
			onchange(res.entity);
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	const override = () => save(names);
	const remove = (name: string) => save(names.filter((n) => n !== name));

	function add(name: string) {
		const clean = name.trim();
		if (!clean) return;
		const exists = names.some((n) => n.toLowerCase() === clean.toLowerCase());
		text = '';
		suggestions = [];
		if (!exists) save([...names, clean]);
		input?.focus();
	}

	let timer: ReturnType<typeof setTimeout>;
	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const res = await api<{ tags: { name: string }[] }>(`/api/tags?facet=${facet}&q=${encodeURIComponent(text.trim())}`).catch(() => null);
			if (res) suggestions = res.tags.filter((t) => !names.includes(t.name));
		}, 150);
	}

	function startAdding() {
		adding = true;
		oninput();
		queueMicrotask(() => input?.focus());
	}
</script>

<div class="facet">
	<div class="label">
		<span>{label}</span>
		{#if inherited}
			<span class="from">from {view.inheritedFrom!.kind} {view.inheritedFrom!.name ? `“${view.inheritedFrom!.name}”` : ''}</span>
		{/if}
	</div>
	<ul class="chips" class:inherited>
		{#each view.tags as tag (tag.slug)}
			<li class="chip" title={inherited ? 'Inherited' : tag.source === 'manual' ? 'Set by you' : 'Filled in automatically'}>
				<span>{tag.name}</span>
				{#if !inherited}
					<button type="button" aria-label="Remove {tag.name}" disabled={busy} onclick={() => remove(tag.name)}>✕</button>
				{/if}
			</li>
		{:else}
			<li class="none">None yet</li>
		{/each}
	</ul>
	<div class="actions">
		{#if inherited}
			<button type="button" class="link" disabled={busy} onclick={override}>Override</button>
		{/if}
		{#if !adding}
			<button type="button" class="link" disabled={busy} onclick={startAdding}>+ Add</button>
		{/if}
	</div>
	{#if adding}
		<form
			class="add"
			onsubmit={(e) => {
				e.preventDefault();
				add(text);
			}}
		>
			<input
				bind:this={input}
				class="input"
				list={listId}
				placeholder="Add {label.toLowerCase()}"
				autocomplete="off"
				autocapitalize="off"
				enterkeyhint="done"
				bind:value={text}
				{oninput}
				onchange={() => {
					if (suggestions.some((s) => s.name === text)) add(text);
				}}
			/>
			<datalist id={listId}>
				{#each suggestions as s (s.name)}<option value={s.name}></option>{/each}
			</datalist>
			<button class="btn" type="submit" disabled={busy || !text.trim()}>Add</button>
			<button class="btn" type="button" onclick={() => (adding = false)}>Done</button>
		</form>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.facet {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.label {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.from {
		font-size: 0.8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-height: 32px;
		padding: 0 4px 0 12px;
		border-radius: 16px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		font-size: 0.9rem;
	}
	.inherited .chip {
		padding-right: 12px;
		background: transparent;
		border-style: dashed;
		color: var(--muted);
	}
	.chip button {
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		border-radius: 50%;
	}
	.none {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.actions {
		display: flex;
		gap: 16px;
	}
	.link {
		min-height: 32px;
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		font-weight: 600;
		cursor: pointer;
	}
	.add {
		display: flex;
		gap: 6px;
	}
	.add .input {
		flex: 1;
		min-width: 0;
	}
	.add .btn {
		flex: none;
		padding: 0 12px;
	}
	.error {
		margin: 0;
		color: var(--danger);
		font-size: 0.9rem;
	}
</style>
