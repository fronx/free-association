<script lang="ts">
    import { onMount, onDestroy, setContext } from 'svelte';
    import * as d3 from 'd3';
    import type { TreemapNode } from './types';

    // Props
    export let node: TreemapNode;
    export let isRoot: boolean = false;
    export let isContributorTree: boolean = false;
    export let x: d3.ScaleLinear<number, number>;
    export let y: d3.ScaleLinear<number, number>;
    
    // Constants
    const GROWTH_RATE = (d: TreemapNode) => d.data.points * 0.05;
    const SHRINK_RATE = (d: TreemapNode) => d.data.points * -0.05;
    const GROWTH_TICK = 50;      // Milliseconds between growth updates
    const GROWTH_DELAY = 500;    // Delay before growth starts
    
    // State
    let isTouching = false;
    let touchStartTime = 0;
    let activeNode: TreemapNode | null = null;
    let isGrowing = false;
    let growthInterval: ReturnType<typeof setInterval> | null = null;
    let growthTimeout: ReturnType<typeof setTimeout> | null = null;
    
    // Make isGrowing available to child components
    setContext('isGrowing', isGrowing);
    
    // Event handlers
    function handleMouseDown(event: MouseEvent) {
        if (isContributorTree || isRoot) return;
        
        event.preventDefault();
        
        // Set touch state
        isTouching = true;
        touchStartTime = Date.now();
        activeNode = node;
        
        // Determine if this is a right-click or left-click
        const isShrinking = event.button === 2; // right click
        
        // Schedule growth/shrink after delay
        growthTimeout = setTimeout(() => {
            if (isTouching && activeNode === node) {
                startGrowth(isShrinking);
            }
        }, GROWTH_DELAY) as unknown as ReturnType<typeof setTimeout>;
    }
    
    function startGrowth(isShrinking: boolean) {
        isGrowing = true;
        setContext('isGrowing', true);
        
        // Start the growth interval
        growthInterval = setInterval(() => {
            if (!isTouching) {
                stopGrowth();
                return;
            }
            
            // Calculate growth/shrink amount
            const rate = isShrinking ? SHRINK_RATE(node) : GROWTH_RATE(node);
            const newPoints = Math.max(0, node.data.points + rate);
            
            if (isNaN(newPoints)) {
                console.error('Growth calculation resulted in NaN:', {
                    currentPoints: node.data.points,
                    rate: rate,
                    isShrinking: isShrinking
                });
                return;
            }
            
            // Update the node's points
            node.data.points = newPoints;
            
        }, GROWTH_TICK) as unknown as ReturnType<typeof setInterval>;
    }
    
    function stopGrowth() {
        isTouching = false;
        activeNode = null;
        
        // Clear timers
        if (growthTimeout) {
            clearTimeout(growthTimeout);
            growthTimeout = null;
        }
        
        if (growthInterval) {
            clearInterval(growthInterval);
            growthInterval = null;
        }
        
        // Reset state
        isGrowing = false;
        setContext('isGrowing', false);
    }
    
    function handleTouchStart(event: TouchEvent) {
        if (isContributorTree || isRoot) return;
        
        event.preventDefault();
        
        // Set touch state
        isTouching = true;
        touchStartTime = Date.now();
        activeNode = node;
        
        // Determine if this is a multi-touch
        const isShrinking = event.touches.length === 2;
        
        // Schedule growth/shrink after delay
        growthTimeout = setTimeout(() => {
            if (isTouching && activeNode === node) {
                startGrowth(isShrinking);
            }
        }, GROWTH_DELAY) as unknown as ReturnType<typeof setTimeout>;
    }
    
    function handleMouseUp() {
        stopGrowth();
    }
    
    function handleTouchEnd() {
        stopGrowth();
    }
    
    function handleContextMenu(event: MouseEvent) {
        event.preventDefault();
    }
    
    // Clean up on destroy
    onDestroy(() => {
        if (growthTimeout) clearTimeout(growthTimeout);
        if (growthInterval) clearInterval(growthInterval);
    });
</script>

<svelte:window on:mouseup={handleMouseUp} on:touchend={handleTouchEnd} on:touchcancel={handleTouchEnd} />

<g
    on:mousedown={handleMouseDown}
    on:touchstart={handleTouchStart}
    on:contextmenu={handleContextMenu}
    role="button"
    aria-label="Growth control"
    tabindex="0"
>
    <slot></slot>
</g> 