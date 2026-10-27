<script lang="ts">
	import { formatStars, starFills } from '../domain/rating';
	import StarIcon from './StarIcon.svelte';

	let { rating, size = 14 }: { rating: number | null; size?: number } = $props();
</script>

{#if rating !== null}
	<span class="stars" role="img" aria-label="{formatStars(rating)} out of 5 stars" style:--size="{size}px">
		{#each starFills(rating) as fill, i (i)}
			<span class="star"><StarIcon {fill} /></span>
		{/each}
	</span>
{/if}

<style>
	.stars {
		display: inline-flex;
		gap: 1px;
		vertical-align: middle;
	}
	.star {
		width: var(--size);
		height: var(--size);
	}
</style>
