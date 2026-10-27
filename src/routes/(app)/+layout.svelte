<script lang="ts">
	import TabBar from '#lib/components/TabBar.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="shell">
	<main>
		{@render children()}
	</main>
	<TabBar />
</div>

<style>
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
