<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
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
		To change the password, run <code>npx tsx scripts/hash-password.ts</code>, set the output as
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
	code {
		overflow-wrap: anywhere;
	}
</style>
