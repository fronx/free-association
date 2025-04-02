<script lang="ts">
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import { getColorForUserId } from '../../utils/colorUtils';
    import { getUserName } from '../../utils/userUtils';
    import type { TreemapNode } from './types';
    import TagSearch from './TagSearch.svelte';

    // Props
    export let node: TreemapNode;
    export let rectWidth: number;
    export let rectHeight: number;
    export let fontSize: number;

    // State
    let showTagSearch = false;
    let tagSearchPosition = { x: 0, y: 0 };

    // Event dispatcher
    const dispatch = createEventDispatcher();
    
    // Container position
    $: verticalOffset = getVerticalOffset();
    
    // Get the types array from the node
    $: typesArray = node.data.types ? Array.from(node.data.types) : [];
    
    function getVerticalOffset() {
        // Calculate based on text lines
        const textLines = node.data.name.split(/(?=[A-Z][^A-Z])/g).length;
        // Offset from center - move down by half the text height plus padding
        return (textLines * 1.2 * fontSize / 2) + 10;
    }
    
    function openTagSearch(event) {
        event.stopPropagation();
        
        // Set position for tag search
        tagSearchPosition = {
            x: event.clientX,
            y: event.clientY
        };
        
        showTagSearch = true;
        dispatch('opentag', { nodeId: node.data.id });
    }
    
    function closeTagSearch() {
        showTagSearch = false;
    }
    
    function handleAddTag(event) {
        closeTagSearch();
        dispatch('addtag', { 
            nodeId: node.data.id, 
            typeId: event.detail.userId 
        });
    }
    
    function removeTag(typeId, event) {
        if (event) event.stopPropagation();
        node.data.removeType(typeId);
        dispatch('removetag', { nodeId: node.data.id, typeId });
    }
    
    function navigateToType(typeId, event) {
        if (event) event.stopPropagation();
        dispatch('navigatetoype', { typeId });
    }
    
    // Format name for display
    function formatName(name: string): string {
        return name.length > 10 ? name.substring(0, 8) + "..." : name;
    }
</script>

<g 
    class="type-tags-container"
    transform={`translate(${rectWidth/2}, ${rectHeight/2 + verticalOffset})`}
>
    <!-- Use foreignObject to render HTML content -->
    <foreignObject
        class="tag-wrapper"
        x={-rectWidth/2 + 10}
        y={0}
        width={rectWidth - 20}
        height={60}
    >
        <div>
            <div 
                style="display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; width: 100%; height: 100%; overflow: hidden;"
            >
                <!-- Add tag button -->
                <div 
                    class="add-tag-button"
                    style="display: flex; align-items: center; justify-content: center; border-radius: 10px; background: #e0e0e0; padding: 2px 8px; margin: 2px; cursor: pointer; height: 20px; font-size: 10px; white-space: nowrap; color: #333;"
                    on:click|stopPropagation={openTagSearch}
                    on:keydown|stopPropagation={(e) => e.key === 'Enter' && openTagSearch(e)}
                    tabindex="0"
                    role="button"
                    aria-label="Add tag"
                >
                    +
                </div>
                
                <!-- Type tags -->
                {#each typesArray as typeId}
                    <div 
                        class="tag-pill"
                        data-type-id={typeId}
                        style="display: flex; align-items: center; border-radius: 10px; background: {getColorForUserId(typeId)}; padding: 2px 8px; margin: 2px; height: 20px; font-size: 10px; white-space: nowrap;"
                        on:click|stopPropagation={(e) => navigateToType(typeId, e)}
                        on:keydown|stopPropagation={(e) => e.key === 'Enter' && navigateToType(typeId, e)}
                        tabindex="0"
                        role="button"
                        title={`${getUserName(typeId)}: Click to view tree, click × to remove`}
                    >
                        <span style="color: white; margin-right: 4px; text-shadow: 0 1px 1px rgba(0,0,0,0.3);">
                            {formatName(getUserName(typeId))}
                        </span>
                        
                        <!-- Remove button -->
                        <span 
                            class="remove-tag"
                            style="cursor: pointer; color: white; font-size: 12px; line-height: 10px; opacity: 0.8; font-weight: bold;"
                            on:click|stopPropagation={(e) => removeTag(typeId, e)}
                            on:keydown|stopPropagation={(e) => e.key === 'Enter' && removeTag(typeId, e)}
                            tabindex="0"
                            role="button"
                            aria-label="Remove tag"
                        >
                            ×
                        </span>
                    </div>
                {/each}
            </div>
        </div>
    </foreignObject>
</g>

<!-- Tag search dropdown -->
{#if showTagSearch}
    <TagSearch 
        {node}
        position={tagSearchPosition}
        excludedIds={typesArray}
        on:close={closeTagSearch}
        on:tag={handleAddTag}
    />
{/if}

<style>
    .type-tags-container {
        opacity: 1;
        transition: opacity 0.15s ease;
    }
    
    :global(.tag-pill) {
        transition: opacity 0.3s, transform 0.3s;
    }
    
    :global(.tag-pill:hover) {
        opacity: 0.9;
    }
    
    :global(.remove-tag:hover) {
        opacity: 1;
    }
    
    :global(.add-tag-button:hover) {
        background: #d0d0d0 !important;
    }
</style> 