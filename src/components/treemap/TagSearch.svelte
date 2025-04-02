<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from 'svelte';
    import { getUserName, loadUsers, onUserNameResolved } from '../../utils/userUtils';
    import { getColorForUserId } from '../../utils/colorUtils';
    import type { TreemapNode } from './types';

    // Props
    export let node: TreemapNode;
    export let position = { x: 0, y: 0 };
    export let excludedIds: string[] = [];
    
    // State
    let filterText = '';
    let users: Array<{id: string, name: string}> = [];
    let loadingUsers = true;
    let container: HTMLDivElement;
    let searchInput: HTMLInputElement;
    let cleanup: () => void;
    
    // Event dispatcher
    const dispatch = createEventDispatcher();
    
    // Methods
    function close() {
        dispatch('close');
    }
    
    function addTag(userId: string) {
        node.data.addType(userId);
        dispatch('tag', { userId });
        close();
    }
    
    // Handle clicks outside the dropdown
    function handleClickOutside(event: MouseEvent) {
        if (container && !container.contains(event.target as Node)) {
            close();
        }
    }
    
    // Handle escape key
    function handleKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            close();
        }
    }
    
    // Load users when component mounts
    onMount(() => {
        // Focus the search input
        if (searchInput) searchInput.focus();
        
        // Set up event listeners
        document.addEventListener('click', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        
        // Load users
        cleanup = loadUsers(loadedUsers => {
            users = loadedUsers;
            loadingUsers = false;
        }, {
            filterText,
            excludeIds: excludedIds
        });
        
        // Position dropdown appropriately
        if (container) {
            // Adjust position to ensure it's visible
            setTimeout(() => {
                if (!container) return;
                
                const rect = container.getBoundingClientRect();
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                
                // Check right edge
                if (rect.right > viewportWidth - 10) {
                    container.style.left = `${viewportWidth - rect.width - 10}px`;
                }
                
                // Check left edge
                if (rect.left < 10) {
                    container.style.left = "10px";
                }
                
                // Check bottom edge
                if (rect.bottom > viewportHeight - 10) {
                    // If dropdown would go above the top, position it at the top with padding
                    if (position.y - rect.height < 10) {
                        container.style.top = "10px";
                    } else {
                        // Otherwise, position above the click
                        container.style.top = `${position.y - rect.height - 10}px`;
                    }
                }
            }, 0);
        }
        
        return () => {
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
            if (cleanup) cleanup();
        };
    });
    
    // Update user list when filter changes
    $: if (cleanup && typeof cleanup === 'function') {
        cleanup();
        loadingUsers = true;
        cleanup = loadUsers(loadedUsers => {
            users = loadedUsers;
            loadingUsers = false;
        }, {
            filterText,
            excludeIds: excludedIds
        });
    }
</script>

<div 
    class="tag-search-dropdown"
    bind:this={container}
    style="position: fixed; top: {position.y + 20}px; left: {position.x - 100}px;"
>
    <div class="header">
        <input 
            type="text" 
            placeholder="Search users..." 
            bind:value={filterText}
            bind:this={searchInput}
        />
        <button class="close-button" on:click={close}>×</button>
    </div>
    
    <div class="results">
        {#if loadingUsers}
            <div class="loading">Loading users...</div>
        {:else if users.length === 0}
            <div class="no-results">
                {filterText ? "No matching users found" : "No users available"}
            </div>
        {:else}
            {#each users as user}
                <button 
                    class="user-item"
                    on:click={() => addTag(user.id)}
                    on:keydown={(e) => e.key === 'Enter' && addTag(user.id)}
                    type="button"
                >
                    <div 
                        class="color-dot"
                        style="background: {getColorForUserId(user.id)};"
                    ></div>
                    <div class="user-name">{user.name}</div>
                </button>
            {/each}
        {/if}
    </div>
</div>

<style>
    .tag-search-dropdown {
        width: 200px;
        height: 250px;
        background: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        z-index: 99999;
    }
    
    .header {
        display: flex;
        align-items: center;
        border-bottom: 1px solid #eee;
        padding: 4px;
    }
    
    input {
        padding: 8px;
        border: none;
        flex: 1;
        outline: none;
        font-size: 12px;
    }
    
    .close-button {
        padding: 4px 8px;
        cursor: pointer;
        color: #666;
        font-weight: bold;
        background: none;
        border: none;
    }
    
    .results {
        overflow-y: auto;
        flex: 1;
    }
    
    .loading, .no-results {
        padding: 8px;
        text-align: center;
        color: #888;
        font-size: 11px;
    }
    
    .user-item {
        padding: 6px 8px;
        cursor: pointer;
        font-size: 12px;
        border-bottom: 1px solid #f0f0f0;
        display: flex;
        align-items: center;
        transition: background 0.2s;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        border-radius: 0;
    }
    
    .user-item:hover {
        background: #f5f5f5;
    }
    
    .color-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 6px;
    }
</style> 