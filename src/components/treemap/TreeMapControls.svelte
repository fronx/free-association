<script lang="ts">
    import type { TreemapNode } from './types';

    // Props
    export let node: TreemapNode;
    export let rectWidth: number;
    export let isContributorTree: boolean = false;

    // Event handlers
    function handleHomeClick(event) {
        event.stopPropagation();
    }

    function handlePeerClick(event) {
        event.stopPropagation();
    }

    function handleAddClick(event) {
        event.stopPropagation();
    }
</script>

{#if isContributorTree}
    <!-- Home button (only for contributor trees) -->
    <g 
        class="home-button"
        transform="translate(20, 25)"
        style="cursor: pointer;"
        on:click|stopPropagation
        on:click={handleHomeClick}
        on:keydown={(e) => e.key === 'Enter' && handleHomeClick(e)}
        tabindex="0"
        role="button"
        aria-label="Home"
    >
        <text
            fill="#000"
            font-size="20px"
            dominant-baseline="middle"
        >
            🏠
        </text>
    </g>
{:else}
    <!-- Only add navigation buttons on our user's tree views (not contributor trees) -->
    <!-- Peer button (on the left of the plus button) -->
    <g 
        class="peer-button"
        transform={`translate(${rectWidth - 60}, 25)`}
        style="cursor: pointer;"
        on:click|stopPropagation
        on:click={handlePeerClick}
        on:keydown={(e) => e.key === 'Enter' && handlePeerClick(e)}
        tabindex="0"
        role="button"
        aria-label="View peers"
    >
        <text
            fill="#000"
            font-size="20px"
            text-anchor="middle"
            dominant-baseline="middle"
        >
            👥
        </text>
    </g>
    
    <!-- Add button for adding values -->
    <g 
        class="add-button"
        transform={`translate(${rectWidth - 20}, 25)`}
        style="cursor: pointer;"
        on:click|stopPropagation
        on:click={handleAddClick}
        on:keydown={(e) => e.key === 'Enter' && handleAddClick(e)}
        tabindex="0"
        role="button"
        aria-label="Add item"
    >
        <text
            fill="#000"
            font-size="20px"
            text-anchor="middle"
            dominant-baseline="middle"
        >
            ➕
        </text>
    </g>
{/if}

<style>
    g:hover text {
        opacity: 0.8;
    }
</style> 