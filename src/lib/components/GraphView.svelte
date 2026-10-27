<script lang="ts">
	import { onMount } from 'svelte';
	import type { Core, ElementDefinition, StylesheetJson } from 'cytoscape';
	import type { Graph, GraphNode } from '../domain/graph';

	let {
		graph,
		focus,
		onselect,
		onopen
	}: { graph: Graph; focus: number | null; onselect: (node: GraphNode | null) => void; onopen: (node: GraphNode) => void } = $props();

	let container: HTMLDivElement;
	let cy: Core | undefined = $state();

	/** Large maps trade detail for smooth pan/zoom on phones. */
	const LARGE = 300;

	function elements(g: Graph): ElementDefinition[] {
		const showArt = g.nodes.length <= 150;
		return [
			...g.nodes.map((n) => ({
				group: 'nodes' as const,
				data: { ...n, art: showArt && n.artworkPath ? `/artwork/${n.artworkPath}` : undefined },
				classes: [n.type, n.stub ? 'stub' : '', n.facet ?? '', n.entityId === focus ? 'focus' : ''].join(' ')
			})),
			...g.links.map((l) => ({
				group: 'edges' as const,
				data: l,
				classes: [l.type, l.directed ? 'directed' : '', l.status].join(' ')
			}))
		];
	}

	function stylesheet(): StylesheetJson {
		const css = getComputedStyle(document.documentElement);
		const v = (name: string) => css.getPropertyValue(name).trim();
		const [text, muted, border, surface, accent] = ['--text', '--muted', '--border', '--surface', '--accent'].map(v);
		return [
			{
				selector: 'node.entity',
				style: {
					width: 34,
					height: 34,
					'background-color': surface,
					'border-width': 2,
					'border-color': accent,
					label: 'data(label)',
					color: text,
					'font-size': 10,
					'text-valign': 'bottom',
					'text-margin-y': 4,
					'text-max-width': '90px',
					'text-wrap': 'ellipsis',
					'min-zoomed-font-size': 7
				}
			},
			{ selector: 'node.entity[art]', style: { 'background-image': 'data(art)', 'background-fit': 'cover', 'border-color': border } },
			{ selector: 'node.stub', style: { 'border-style': 'dashed', 'border-color': muted, opacity: 0.85 } },
			{ selector: 'node.focus', style: { 'border-width': 4, 'border-color': accent, width: 44, height: 44 } },
			{
				selector: 'node.hub',
				style: {
					shape: 'round-rectangle',
					width: (n: { data: (k: string) => string }) => Math.max(36, n.data('label').length * 6.5 + 14),
					height: 22,
					padding: '6px',
					label: 'data(label)',
					'font-size': 11,
					'font-weight': 600,
					'text-valign': 'center',
					color: '#fff',
					'min-zoomed-font-size': 6
				}
			},
			{ selector: 'node.genre', style: { 'background-color': '#7c3aed' } },
			{ selector: 'node.era', style: { 'background-color': '#0e7490' } },
			{ selector: 'node.instrument', style: { 'background-color': '#b45309' } },
			{ selector: 'node:selected', style: { 'overlay-color': accent, 'overlay-opacity': 0.25, 'overlay-padding': 6 } },
			{ selector: 'edge', style: { width: 1.5, 'curve-style': 'haystack', 'line-color': border, opacity: 0.9 } },
			{ selector: 'edge.genre, edge.era, edge.instrument', style: { width: 1, opacity: 0.45 } },
			{ selector: 'edge.similar', style: { width: 2, 'line-color': muted } },
			{
				selector: 'edge.inspired',
				style: {
					width: 2,
					'curve-style': 'straight',
					'line-color': accent,
					'target-arrow-shape': 'triangle',
					'target-arrow-color': accent,
					'arrow-scale': 0.9
				}
			},
			{ selector: 'edge.suggested', style: { 'line-style': 'dotted', opacity: 0.45 } }
		];
	}

	function render() {
		if (!cy) return;
		const large = graph.nodes.length > LARGE;
		cy.batch(() => {
			cy!.elements().remove();
			cy!.add(elements(graph));
		});
		cy.layout({
			name: 'fcose',
			animate: false,
			randomize: true,
			quality: large ? 'draft' : 'default',
			// Count labels as part of each node so names don't overlap.
			nodeDimensionsIncludeLabels: true,
			nodeRepulsion: () => 9000,
			idealEdgeLength: () => 90,
			nodeSeparation: 80,
			packComponents: true,
			tilingPaddingVertical: 30,
			tilingPaddingHorizontal: 30,
			fit: true,
			padding: 40
		} as never).run();
		// Fitting a handful of nodes would blow them up to max zoom.
		if (cy.zoom() > 1.25) {
			cy.zoom(1.25);
			cy.center();
		}
		if (focus !== null) cy.center(cy.$id(`e${focus}`));
		container.dataset.ready = String(Date.now());
	}

	onMount(() => {
		let destroyed = false;
		(async () => {
			const [{ default: cytoscape }, { default: fcose }] = await Promise.all([import('cytoscape'), import('cytoscape-fcose')]);
			if (destroyed) return;
			cytoscape.use(fcose);
			const large = graph.nodes.length > LARGE;
			cy = cytoscape({
				container,
				style: stylesheet(),
				minZoom: 0.15,
				maxZoom: 3,
				// 3x canvases are costly to repaint on phones; 2x looks the same at these sizes.
				pixelRatio: large ? 1 : Math.min(window.devicePixelRatio || 1, 2),
				hideEdgesOnViewport: large,
				motionBlur: false
			});
			cy.on('tap', 'node', (e) => onselect(e.target.data() as GraphNode));
			cy.on('dbltap', 'node', (e) => onopen(e.target.data() as GraphNode));
			cy.on('tap', (e) => {
				if (e.target === cy) onselect(null);
			});
		})();
		return () => {
			destroyed = true;
			cy?.destroy();
		};
	});

	// Re-render whenever the graph data (or focus) changes.
	$effect(() => {
		void graph;
		void focus;
		if (cy) render();
	});
</script>

<div
	class="graph"
	bind:this={container}
	role="application"
	aria-label="Relationship map"
	data-nodes={graph.nodes.length}
	data-links={graph.links.length}
></div>

<style>
	.graph {
		position: absolute;
		inset: 0;
	}
</style>
