<script lang="ts">
	import { formatStars, starFills } from '../domain/rating';

	let { value = $bindable(null) }: { value: number | null } = $props();

	const STAR = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z';

	function onkeydown(e: KeyboardEvent) {
		const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
		if (step === undefined) return;
		e.preventDefault();
		value = Math.min(10, Math.max(0, (value ?? 0) + step));
	}
</script>

<div class="rating">
	<div
		class="stars"
		role="slider"
		tabindex="0"
		aria-label="Rating"
		aria-valuemin={0}
		aria-valuemax={10}
		aria-valuenow={value ?? undefined}
		aria-valuetext={value === null ? 'Unrated' : `${formatStars(value)} stars`}
		{onkeydown}
	>
		{#each starFills(value) as fill, i (i)}
			<span class="star">
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<defs><clipPath id="in-half-{i}"><rect width="12" height="24" /></clipPath></defs>
					<path class="bg" d={STAR} />
					{#if fill !== 'empty'}
						<path class="fg" clip-path={fill === 'half' ? `url(#in-half-${i})` : undefined} d={STAR} />
					{/if}
				</svg>
				<button type="button" class="half left" tabindex="-1" aria-label="{i}½ stars" onclick={() => (value = i * 2 + 1)}></button>
				<button type="button" class="half right" tabindex="-1" aria-label="{i + 1} stars" onclick={() => (value = i * 2 + 2)}></button>
			</span>
		{/each}
	</div>
	<div class="extra">
		<span class="value">{value === null ? 'Unrated' : `${formatStars(value)} / 5`}</span>
		<button type="button" class="chip" aria-pressed={value === 0} onclick={() => (value = 0)}>0</button>
		<button type="button" class="chip" disabled={value === null} onclick={() => (value = null)}>Clear</button>
	</div>
</div>

<style>
	.rating {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.stars {
		display: flex;
		gap: 2px;
		border-radius: 8px;
		width: max-content;
	}
	.stars:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.star {
		position: relative;
		width: 48px;
		height: 48px;
	}
	svg {
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.bg {
		fill: var(--surface-2);
		stroke: var(--border);
		stroke-width: 0.8;
	}
	.fg {
		fill: var(--accent);
	}
	.half {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 50%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	.left {
		left: 0;
	}
	.right {
		right: 0;
	}
	.extra {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.value {
		flex: 1;
		color: var(--muted);
		font-size: 0.9rem;
	}
	.chip {
		min-height: 36px;
		min-width: 44px;
		padding: 0 12px;
		border-radius: 18px;
		border: 1px solid var(--border);
		background: var(--surface);
	}
	.chip[aria-pressed='true'] {
		border-color: var(--accent);
		color: var(--accent);
	}
	.chip:disabled {
		opacity: 0.4;
	}
</style>
