<script lang="ts">
	import { page } from '$app/state';

	const offline = typeof navigator !== 'undefined' && !navigator.onLine;
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Not found' : 'Error'} · Music Map</title>
</svelte:head>

<main>
	<h1>{page.status === 404 ? 'Not found' : offline ? "You're offline" : 'Something went wrong'}</h1>
	<p class="muted">
		{#if page.status === 404}
			That page or item doesn't exist (it may have been merged or removed).
		{:else if offline}
			This page wasn't saved for offline use. Reconnect and try again.
		{:else}
			{page.error?.message ?? 'Unexpected error.'}
		{/if}
	</p>
	<a class="btn btn-primary" href="/list">Back to your list</a>
</main>

<style>
	main {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: calc(24px + var(--safe-top)) 24px calc(24px + var(--safe-bottom));
		text-align: center;
	}
	p {
		max-width: 360px;
	}
</style>
