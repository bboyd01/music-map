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
	code {
		overflow-wrap: anywhere;
	}
</style>
