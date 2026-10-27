<script lang="ts">
	import { page } from '$app/state';

	let { suggestionCount = 0 }: { suggestionCount?: number } = $props();

	const tabs = [
		{ href: '/list', label: 'List', icon: 'M4 6h16M4 12h16M4 18h10' },
		{
			href: '/map',
			label: 'Map',
			icon: 'M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M18 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M10 18m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M8.3 7l7.4 0.8M7.2 8.2l2 7.4M16.4 10l-4.6 6'
		},
		{ href: '/add', label: 'Add', icon: 'M12 5v14M5 12h14' },
		{
			href: '/suggestions',
			label: 'Suggestions',
			icon: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.2 1 2.1h5c0-.9.4-1.7 1-2.1A6 6 0 0 0 12 3z'
		},
		{
			href: '/settings',
			label: 'Settings',
			icon: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1'
		}
	];

	const active = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<nav aria-label="Main">
	{#each tabs as tab (tab.href)}
		<a href={tab.href} aria-current={active(tab.href) ? 'page' : undefined}>
			<span class="icon">
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d={tab.icon} />
				</svg>
				{#if tab.href === '/suggestions' && suggestionCount}
					<span class="badge" aria-label="{suggestionCount} pending">{suggestionCount > 99 ? '99+' : suggestionCount}</span>
				{/if}
			</span>
			<span>{tab.label}</span>
		</a>
	{/each}
</nav>

<style>
	nav {
		position: fixed;
		z-index: 10;
		left: 0;
		right: 0;
		bottom: 0;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		height: calc(var(--tabbar-h) + var(--safe-bottom));
		padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(12px);
		border-top: 1px solid var(--border);
	}
	a {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-height: var(--tap);
		min-width: 0;
		color: var(--muted);
		text-decoration: none;
		font-size: 0.7rem;
	}
	a[aria-current='page'] {
		color: var(--accent);
	}
	.icon {
		position: relative;
		display: flex;
	}
	.badge {
		position: absolute;
		top: -6px;
		left: 14px;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--accent);
		color: var(--accent-text);
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 18px;
		text-align: center;
	}
	span:not(.icon, .badge) {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (min-width: 768px) {
		nav {
			top: 0;
			right: auto;
			width: calc(var(--rail-w) + var(--safe-left));
			height: auto;
			grid-template-columns: 1fr;
			grid-auto-rows: 72px;
			align-content: start;
			padding: calc(16px + var(--safe-top)) 0 0 var(--safe-left);
			border-top: none;
			border-right: 1px solid var(--border);
		}
	}
</style>
