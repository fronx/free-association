<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { getUserName, onUserNameResolved } from '../../utils/userUtils';

    // Props
    export let typeId: string;
    
    // State
    let displayName = '';
    let cleanup: (() => void) | null = null;
    
    onMount(() => {
        // Set initial name
        displayName = getUserName(typeId);
        
        // Subscribe to name changes
        cleanup = onUserNameResolved(typeId, (userId, resolvedName) => {
            displayName = resolvedName;
        });
    });
    
    onDestroy(() => {
        if (cleanup) cleanup();
    });
    
    // Format name for display
    $: formattedName = displayName.length > 10 ? displayName.substring(0, 8) + "..." : displayName;
</script>

<span style="color: white; margin-right: 4px; text-shadow: 0 1px 1px rgba(0,0,0,0.3);">
    {formattedName}
</span> 