<script lang="ts">
	let { fill }: { fill: 'full' | 'half' | 'empty' } = $props();
	const uid = $props.id();
	const clip = `star-half-${uid}`;
	const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z';
</script>

<svg viewBox="0 0 24 24" aria-hidden="true">
	<defs><clipPath id={clip}><rect width="12" height="24" /></clipPath></defs>
	<path class="bg" d={STAR} />
	{#if fill !== 'empty'}
		<path class="fg" clip-path={fill === 'half' ? `url(#${clip})` : undefined} d={STAR} />
	{/if}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.bg {
		fill: var(--surface-2);
		stroke: var(--border);
		stroke-width: 0.9;
	}
	.fg {
		fill: var(--accent);
	}
</style>
