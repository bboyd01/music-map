<script lang="ts">
	import TabBar from '#lib/components/TabBar.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	let online = $state(true);
	$effect(() => {
		const update = () => (online = navigator.onLine);
		update();
		addEventListener('online', update);
		addEventListener('offline', update);
		return () => {
			removeEventListener('online', update);
			removeEventListener('offline', update);
		};
	});
</script>

{#if !online}
	<div class="offline" role="status">You're offline. Showing what was last loaded; changes need a connection.</div>
{/if}

<div class="shell">
	<main>
		{@render children()}
	</main>
	<TabBar suggestionCount={data.suggestionCount} />
</div>

<style>
	.offline {
		position: sticky;
		top: 0;
		z-index: 20;
		padding: calc(8px + var(--safe-top)) 16px 8px;
		background: var(--text);
		color: var(--bg);
		font-size: 0.85rem;
		text-align: center;
	}
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right))
			calc(var(--tabbar-h) + var(--safe-bottom) + 16px) calc(16px + var(--safe-left));
	}

	@media (min-width: 768px) {
		.shell {
			padding-left: calc(var(--rail-w) + var(--safe-left));
		}
		main {
			padding: calc(24px + var(--safe-top)) 24px 24px;
		}
	}
</style>
