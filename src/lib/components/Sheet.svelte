<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		children
	}: { open: boolean; title: string; children: Snippet } = $props();

	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	aria-label={title}
	onclose={() => (open = false)}
	onclick={(e) => {
		if (e.target === dialog) open = false;
	}}
>
	<div class="sheet">
		<header>
			<h2>{title}</h2>
			<button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>✕</button>
		</header>
		{#if open}
			{@render children()}
		{/if}
	</div>
</dialog>

<style>
	dialog {
		width: 100%;
		max-width: 560px;
		max-height: 92dvh;
		margin: auto auto 0;
		padding: 0;
		border: none;
		border-radius: 18px 18px 0 0;
		background: var(--surface);
		color: var(--text);
		overflow: auto;
		overscroll-behavior: contain;
	}
	dialog[open] {
		animation: up 0.18s ease-out;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}
	.sheet {
		padding: 8px 16px calc(20px + var(--safe-bottom));
	}
	header {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 0;
		background: var(--surface);
	}
	h2 {
		flex: 1;
		margin: 0;
		font-size: 1.05rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.close {
		width: 44px;
		height: 44px;
		border: none;
		background: transparent;
		font-size: 1.1rem;
		color: var(--muted);
		cursor: pointer;
	}
	@media (min-width: 768px) {
		dialog {
			margin: auto;
			border-radius: 18px;
		}
	}
	@keyframes up {
		from {
			transform: translateY(24px);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog[open] {
			animation: none;
		}
	}
</style>
