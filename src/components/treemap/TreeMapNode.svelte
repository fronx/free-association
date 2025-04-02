<script lang="ts">
    import { getContext } from 'svelte';
    import { getColorForName, getColorForUserId } from '../../utils/colorUtils';
    import { calculateFontSize, name } from '../../utils/fontUtils';
    import type { NodeProps, TreemapNode } from './types';
    import TypeTags from './TypeTags.svelte';

    // Props
    export let node: TreemapNode;
    export let isRoot: boolean = false;
    export let x: d3.ScaleLinear<number, number>;
    export let y: d3.ScaleLinear<number, number>;
    export let currentView: TreemapNode;

    // Get treemap context for methods
    const { zoomin, zoomout } = getContext('treemap') as { 
        zoomin: (node: TreemapNode) => void;
        zoomout: (node: TreemapNode) => void;
    };

    // Derived properties
    $: rectWidth = isRoot ? x.range()[1] : x(node.x1) - x(node.x0);
    $: rectHeight = isRoot ? 50 : y(node.y1) - y(node.y0);
    $: fontSize = calculateFontSize(node, rectWidth, rectHeight, isRoot ? node : null, x, y, currentView);
    $: textLines = isRoot ? [name(node)] : node.data.name.split(/(?=[A-Z][^A-Z])/g);
    $: nodeColor = isRoot ? "#fff" : getColorForName(node.data.name);
    $: strokeColor = node.data.hasDirectContributionChild ? "#2196f3" : "#fff";
    $: strokeWidth = node.data.hasDirectContributionChild ? 3 : 2;

    // Node click handler
    function handleClick(event: MouseEvent | KeyboardEvent) {
        event.preventDefault();
        
        // Only handle normal clicks (not during growth)
        if (!getContext('isGrowing')) {
            if (isRoot && node.parent) {
                zoomout(node);
            } else if (!isRoot && !node.data.isContribution) {
                zoomin(node);
            }
        }
    }
</script>

<g 
    class="treemap-node" 
    class:root={isRoot}
    transform={isRoot ? `translate(0,-50)` : `translate(${x(node.x0)},${y(node.y0)})`}
    on:click={handleClick}
    on:keydown={(e) => e.key === 'Enter' && handleClick(e)}
    tabindex="0"
    role="button"
    aria-label={name(node)}
    cursor="pointer"
>
    <title>{name(node)}</title>
    
    <rect
        width={rectWidth}
        height={rectHeight}
        fill={nodeColor}
        stroke={strokeColor}
        stroke-width={strokeWidth}
    />
    
    <text
        font-weight={isRoot ? "bold" : null}
        transform={`translate(${rectWidth/2},${rectHeight/2})`}
        text-anchor="middle"
        dominant-baseline="middle"
        style="font-size: {fontSize}px; user-select: none; pointer-events: none;"
    >
        {#each textLines as line, i}
            <tspan
                x="0"
                dy={i === 0 ? `${-(textLines.length - 1) * 1.2 / 2}em` : "1.2em"}
            >{line}</tspan>
        {/each}
    </text>
    
    <!-- Add type tags if node has types and enough space -->
    {#if !isRoot && rectWidth >= 60 && rectHeight >= 60}
        <TypeTags 
            {node}
            {rectWidth}
            {rectHeight}
            {fontSize}
        />
    {/if}
    
    <!-- Add buttons if this is the root node -->
    <slot name="controls"></slot>
</g>

<style>
    .treemap-node {
        transition: transform 0.75s;
    }
    
    text {
        transition: font-size 0.3s;
    }
    
    rect {
        transition: width 0.75s, height 0.75s;
    }
</style> 