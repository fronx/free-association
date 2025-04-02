<script lang="ts">
    import { onMount, onDestroy, setContext } from 'svelte';
    import { writable, derived, get } from 'svelte/store';
    import type { Writable, Readable } from 'svelte/store';
    import type { TreeNode } from '../../models/TreeNode';
    import type { TreeNode as ReactTreeNode } from '../../models/ReactTreeNode';
    import type { TreemapInstance, TreemapNode } from './types';
    import { createTreemap } from './treemapCore';
    import TreeMapNode from './TreeMapNode.svelte';
    import TreeMapControls from './TreeMapControls.svelte';
    import NodeGrowthHandler from './NodeGrowthHandler.svelte';
    import type { NodeStore } from '../../models/NodeStore';

    // Props - can be either direct ReactTreeNode or a NodeStore wrapper
    export let data: ReactTreeNode | NodeStore;
    export let width: number = 800;
    export let height: number = 600;
    
    // Get the actual ReactTreeNode if data is a NodeStore
    const reactNode = data instanceof Object && 'nodeRef' in data 
        ? (data as NodeStore).nodeRef 
        : data as ReactTreeNode;
    
    // Component state
    let container: HTMLDivElement;
    let treemap: TreemapInstance;
    let svg: SVGSVGElement;
    
    // Stores for reactive updating
    const currentView = writable<TreemapNode>(null);
    const rootNode = writable<TreemapNode>(null);
    const x = writable<d3.ScaleLinear<number, number>>(null);
    const y = writable<d3.ScaleLinear<number, number>>(null);
    const isGrowing = writable<boolean>(false);
    
    // Create reactive name store from ReactTreeNode or NodeStore
    const nodeName = writable<string>(reactNode.name);
    
    // If using NodeStore, subscribe to name changes
    let nameUnsubscribe: (() => void) | null = null;
    if ('nodeRef' in data) {
        const nameStore = (data as NodeStore).property<string>('name');
        nameUnsubscribe = nameStore.subscribe(value => {
            nodeName.set(value);
        });
    }
    
    // Share context for child components
    setContext('treemap', {
        zoomin: (node: TreemapNode) => {
            if (treemap) treemap.zoomin(node.data);
        },
        zoomout: (node: TreemapNode) => {
            if (treemap) treemap.zoomout(node.data);
        },
        getCurrentView: () => $currentView,
        getRoot: () => $rootNode,
        isInContributorTree: (node: TreemapNode) => isInContributorTree(node, reactNode),
        currentView,
        rootNode,
        x,
        y,
        // Provide node store if available
        nodeStore: 'nodeRef' in data ? data : null
    });

    // Share growth context
    setContext('isGrowing', isGrowing);
    
    // Initialize the treemap when mounted
    onMount(() => {
        console.log('[Treemap] onMount - Component mounting with data:', reactNode);
        console.log('[Treemap] onMount - reactNode properties:', {
            id: reactNode.id,
            name: reactNode.name,
            points: reactNode.points,
            children: reactNode.children ? Array.from(reactNode.children.values()).length : 0
        });
        
        if (container) {
            console.log('[Treemap] onMount - Container is available, creating treemap');
            try {
                treemap = createTreemap(reactNode, width, height);
                console.log('[Treemap] onMount - Treemap created:', treemap);
                
                svg = treemap.element as unknown as SVGSVGElement;
                console.log('[Treemap] onMount - SVG element:', svg);
                
                container.appendChild(svg);
                console.log('[Treemap] onMount - SVG appended to container');
                
                // Update stores with initial values
                const rootVal = treemap.getRoot();
                console.log('[Treemap] onMount - Root node:', rootVal);
                rootNode.set(rootVal);
                
                const viewVal = treemap.getRoot();
                console.log('[Treemap] onMount - Current view:', viewVal);
                currentView.set(viewVal);
                
                const xScale = treemap.getXScale();
                console.log('[Treemap] onMount - X scale:', xScale);
                x.set(xScale);
                
                const yScale = treemap.getYScale();
                console.log('[Treemap] onMount - Y scale:', yScale);
                y.set(yScale);
            } catch (error) {
                console.error('[Treemap] onMount - Error creating treemap:', error);
            }
            
            // Set up resize handler
            const resizeObserver = new ResizeObserver((entries) => {
                for (let entry of entries) {
                    const { width, height } = entry.contentRect;
                    if (treemap && width > 0 && height > 0) {
                        console.log('[Treemap] Resize - Updating treemap with new dimensions:', { width, height });
                        treemap.update(width, height);
                        // Update scales after resize
                        x.set(treemap.getXScale());
                        y.set(treemap.getYScale());
                    }
                }
            });
            
            resizeObserver.observe(container);
            
            return () => {
                resizeObserver.disconnect();
            };
        } else {
            console.error('[Treemap] onMount - Container is not available!');
        }
    });
    
    // Debug reactive values
    $: console.log('[Treemap] Reactive update - Current view:', $currentView);
    $: console.log('[Treemap] Reactive update - X scale:', $x);
    $: console.log('[Treemap] Reactive update - Y scale:', $y);
    $: if ($currentView) {
        console.log('[Treemap] Reactive update - Current view has children:', $currentView.children ? $currentView.children.length : 0);
    }
    
    // Clean up when component is destroyed
    onDestroy(() => {
        if (treemap) {
            treemap.destroy();
        }
        
        // Clean up name subscription if using NodeStore
        if (nameUnsubscribe) {
            nameUnsubscribe();
        }
    });
    
    // Update treemap if dimensions change
    $: if (treemap && width > 0 && height > 0) {
        treemap.update(width, height);
    }
    
    // Expose methods for parent component
    export function zoomIn(node: ReactTreeNode) {
        if (treemap) {
            treemap.zoomin(node);
            setTimeout(() => {
                // Update stores after zoom animation completes
                currentView.set(treemap.getRoot());
                x.set(treemap.getXScale());
                y.set(treemap.getYScale());
            }, 750) as unknown as ReturnType<typeof setTimeout>; // Match the transition duration
        }
    }
    
    export function zoomOut(node: ReactTreeNode) {
        if (treemap) {
            treemap.zoomout(node);
            setTimeout(() => {
                // Update stores after zoom animation completes
                currentView.set(treemap.getRoot());
                x.set(treemap.getXScale());
                y.set(treemap.getYScale());
            }, 750) as unknown as ReturnType<typeof setTimeout>; // Match the transition duration
        }
    }
    
    export function getCurrentView(): ReactTreeNode {
        // Cast the result to ReactTreeNode as we're using that type internally
        return treemap ? treemap.getCurrentView() as ReactTreeNode : null;
    }

    // Function to determine if we're in a contributor tree
    function isInContributorTree(node: TreemapNode, originalData: ReactTreeNode): boolean {
        let temp = node;
        while (temp) {
            if (temp.data === originalData) {
                return false;
            }
            temp = temp.parent;
        }
        return true;
    }
    
    // Create a store for contributor tree state
    const isContributorTreeStore = writable(false);
    
    // Update whenever current view changes
    $: if ($currentView) {
        isContributorTreeStore.set(isInContributorTree($currentView, reactNode));
    }
    
    // Share as context
    setContext('isContributorTree', isContributorTreeStore);

    // Ensure treemap updates when node name changes (via NodeStore)
    $: if (treemap && $nodeName) {
        // Just update the node's name in the treemap
        treemap.updateNodeData(reactNode);
    }
</script>

<div class="treemap-container" bind:this={container}>
    {#if $currentView && $x && $y}
        <svg width={width} height={height}>
            <g>
                <!-- Root node -->
                <TreeMapNode 
                    node={$currentView} 
                    isRoot={true}
                    x={$x}
                    y={$y}
                    currentView={$currentView}
                >
                    <div slot="controls">
                        <TreeMapControls 
                            node={$currentView}
                            rectWidth={$x.range()[1]}
                            isContributorTree={$isContributorTreeStore}
                        />
                    </div>
                </TreeMapNode>
                
                <!-- Child nodes -->
                {#if $currentView.children}
                    {#each $currentView.children as child}
                        {#if child.data.points > 0}
                            <TreeMapNode 
                                node={child}
                                isRoot={false}
                                x={$x}
                                y={$y}
                                currentView={$currentView}
                            />
                        {/if}
                    {/each}
                {/if}
            </g>
        </svg>
        
        <!-- Growth handler component -->
        <NodeGrowthHandler 
            node={$currentView}
            isRoot={true}
            isContributorTree={false}
            x={$x}
            y={$y}
            on:growthchange={() => {
                // Update scales since positions might have changed
                if (treemap) {
                    x.set(treemap.getXScale());
                    y.set(treemap.getYScale());
                }
            }}
            on:growthstart={() => isGrowing.set(true)}
            on:growthend={() => isGrowing.set(false)}
        />
    {/if}
</div>

<style>
    .treemap-container {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
    }
    
    svg {
        display: block;
        width: 100%;
        height: 100%;
    }
</style> 