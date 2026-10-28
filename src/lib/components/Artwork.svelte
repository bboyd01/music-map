<script lang="ts">
	let {
		path = null,
		url = undefined,
		name,
		size = 64
	}: { path?: string | null; url?: string; name: string; size?: number } = $props();

	// Up to 64px (192 device pixels on phones), the ~200px copy looks the same and loads far faster.
	const src = $derived(path ? `/artwork/${path}${size <= 64 ? '?small' : ''}` : url);
	let failed = $state(false);
	const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

{#if src && !failed}
	<img
		{src}
		alt=""
		width={size}
		height={size}
		loading="lazy"
		decoding="async"
		style:--size="{size}px"
		onerror={() => (failed = true)}
	/>
{:else}
	<div class="placeholder" style:--size="{size}px" style:--hue={hue} aria-hidden="true">
		{name.trim().charAt(0).toUpperCase() || '♪'}
	</div>
{/if}

<style>
	img,
	.placeholder {
		width: var(--size);
		height: var(--size);
		flex: none;
		border-radius: 8px;
		object-fit: cover;
		background: var(--surface-2);
	}
	.placeholder {
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: calc(var(--size) * 0.4);
		color: hsl(var(--hue) 45% 35%);
		background: hsl(var(--hue) 50% 88%);
	}
	@media (prefers-color-scheme: dark) {
		.placeholder {
			color: hsl(var(--hue) 50% 80%);
			background: hsl(var(--hue) 30% 25%);
		}
	}
</style>
