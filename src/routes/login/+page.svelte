<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let submitting = $state(false);

	// Logged out (or session expired): drop pages and artwork cached for offline reading.
	$effect(() => {
		if ('caches' in window) for (const name of ['pages', 'artwork']) caches.delete(name);
	});
</script>

<svelte:head>
	<title>Log in · Music Map</title>
</svelte:head>

<main>
	<img src="/icons/icon-192.png" alt="" width="72" height="72" />
	<h1>Music Map</h1>
	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		<label class="visually-hidden" for="password">Password</label>
		<input
			class="input"
			id="password"
			name="password"
			type="password"
			placeholder="Password"
			autocomplete="current-password"
			required
		/>
		{#if form?.message}
			<p class="error" role="alert">{form.message}</p>
		{/if}
		<button class="btn btn-primary" type="submit" disabled={submitting}>
			{submitting ? 'Logging in…' : 'Log in'}
		</button>
	</form>
</main>

<style>
	main {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: calc(24px + var(--safe-top)) 24px calc(24px + var(--safe-bottom));
		gap: 8px;
	}
	img {
		border-radius: 18px;
	}
	form {
		width: 100%;
		max-width: 340px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.error {
		margin: 0;
		color: var(--danger);
		font-size: 0.95rem;
	}
</style>
