<script lang="ts">
	import { formatStars, starFills } from '../domain/rating';

	let { rating, size = 14 }: { rating: number | null; size?: number } = $props();
</script>

{#if rating !== null}
	<span class="stars" role="img" aria-label="{formatStars(rating)} out of 5 stars" style:--size="{size}px">
		{#each starFills(rating) as fill, i (i)}
			<svg viewBox="0 0 24 24" class={fill} aria-hidden="true">
				<defs>
					<clipPath id="half-{i}"><rect x="0" y="0" width="12" height="24" /></clipPath>
				</defs>
				<path class="bg" d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" />
				{#if fill !== 'empty'}
					<path
						class="fg"
						clip-path={fill === 'half' ? `url(#half-${i})` : undefined}
						d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"
					/>
				{/if}
			</svg>
		{/each}
	</span>
{/if}

<style>
	.stars {
		display: inline-flex;
		gap: 1px;
		vertical-align: middle;
	}
	svg {
		width: var(--size);
		height: var(--size);
	}
	.bg {
		fill: var(--surface-2);
		stroke: var(--border);
		stroke-width: 1;
	}
	.fg {
		fill: var(--accent);
	}
</style>
