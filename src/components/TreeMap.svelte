<script lang="ts">
    import type { TreeNode } from '../models/TreeNode';
    import type { TreeNode as ReactTreeNode } from '../models/ReactTreeNode';
    import type { NodeStore } from '../models/NodeStore';
    import Treemap from './treemap/Treemap.svelte';
    
    // Props - allow either ReactTreeNode or NodeStore
    export let data: ReactTreeNode | NodeStore;
    export let width: number = 800;
    export let height: number = 600;
    
    // Expose methods for parent components
    export function zoomIn(node: ReactTreeNode) {
        if (treemapComponent) {
            treemapComponent.zoomIn(node);
        }
    }
    
    export function zoomOut(node: ReactTreeNode) {
        if (treemapComponent) {
            treemapComponent.zoomOut(node);
        }
    }
    
    export function getCurrentView() {
        if (treemapComponent) {
            return treemapComponent.getCurrentView();
        }
        return null;
    }
    
    // Component reference
    let treemapComponent: any;
</script>

<div class="treemap-wrapper">
    <Treemap bind:this={treemapComponent} {data} {width} {height} />
</div>

<style>
    .treemap-wrapper {
        width: 100%;
        height: 100%;
        position: relative;
    }
</style>