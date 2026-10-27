<script lang="ts">
	import SuggestionList from '#lib/components/SuggestionList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Suggestions · Music Map</title>
</svelte:head>

<h1>Suggestions</h1>
{#if data.suggestions.length}
	<p class="muted">Links found in Wikidata, MusicBrainz and Last.fm. Accepted ones become normal links on the map; rejected ones won't come back.</p>
	<SuggestionList suggestions={data.suggestions} />
{:else}
	<p class="muted">No suggestions right now. They appear after artists are enriched, when Wikidata or MusicBrainz know who influenced them.</p>
{/if}
