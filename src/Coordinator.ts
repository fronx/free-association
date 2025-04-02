import { gun, user } from './models/Gun';
import { TreeNode } from './models/ReactTreeNode'; 
import { updateUserProfile } from './utils/userUtils';
import { initializeExampleData } from './example';
import type { SvelteComponent } from 'svelte';
import { writable, derived, get } from 'svelte/store';
import type { Writable, Readable } from 'svelte/store';
import { createNodeTreeStore, NodeStore } from './models/NodeStore';

/**
 * Coordinator - Manages state and coordinates between Svelte components and ReactTreeNode
 */
export class Coordinator {
    // Basic app properties
    name: string = '';
    rootId: string = '';
    rootNode: TreeNode | null = null;
    initializing: boolean = true;
    
    // Component references
    private treeMapComponent: SvelteComponent | null = null;
    private pieChartComponent: SvelteComponent | null = null;
    
    // Svelte stores for reactivity
    private rootNodeStore: NodeStore | null = null;
    private nodeStoreMap: Map<string, NodeStore> = new Map();
    private isInitialized = writable<boolean>(false);
    
    // Resource management
    private _subscriptions: Array<() => void> = [];
    saveInterval: any = null;
    
    // Required App interface properties
    gunRef: any = gun;
    
    /**
     * Initialize the coordinator
     * @throws Error if user is not authenticated
     */
    constructor() {
        console.log('[Coordinator] Constructor started');
        
        // Validate authentication
        if (!user.is || !user.is.pub) {
            console.error('[Coordinator] User not properly authenticated!', user.is);
            throw new Error('Must be properly authenticated before initializing Coordinator');
        }
        
        this.name = user.is.alias as string || 'Unknown User';
        this.rootId = user.is.pub as string;
        
        // Ensure we have valid data
        if (!this.rootId) {
            console.error('[Coordinator] Missing user public key!');
            throw new Error('User public key is missing or invalid');
        }
        
        console.log('[Coordinator] User information:', { name: this.name, rootId: this.rootId });
    }
    
    /**
     * Initialize the coordinator
     */
    async initialize(): Promise<void> {
        console.log('[Coordinator] Starting initialization');

        try {
            // Phase 1: Load root node
            console.log('[Coordinator] Phase 1: Loading root node');
            await this.initializeRootNode();
            
            // Phase 2: Initialize example data if needed
            console.log('[Coordinator] Phase 2: Checking for example data');
            await this.initializeExampleDataIfNeeded();
            
            // Create store from root node after initialization
            if (this.rootNode) {
                this.rootNodeStore = createNodeTreeStore(this.rootNode);
                this.nodeStoreMap.set(this.rootId, this.rootNodeStore);
            }
            
            this.initializing = false;
            this.isInitialized.set(true);
            console.log('[Coordinator] Initialization completed successfully');
        } catch (error) {
            console.error('[Coordinator] Initialization failed with error:', error);
            throw error;
        }
    }
    
    /**
     * Load or create the root node
     */
    private async initializeRootNode(): Promise<void> {
        console.log('[Coordinator] Attempting to load existing root node with ID:', this.rootId);
        
        // Get the node using the static getNode method
        const existingNode = TreeNode.getNode(this.rootId, this as unknown as any);
        
        // Try to wait for data to load
        this.rootNode = await Promise.race([
            new Promise<TreeNode>(resolve => {
                existingNode.gunNode.once()
                    .then(data => {
                        if (data && (data.name || data.id)) {
                            console.log('[Coordinator] Found existing node data:', data);
                            resolve(existingNode);
                        } else {
                            console.log('[Coordinator] Node exists but has insufficient data:', data);
                            resolve(null as any);
                        }
                    })
                    .catch(err => {
                        console.log('[Coordinator] Error checking node data:', err);
                        resolve(null as any);
                    });
            }),
            new Promise<null>(resolve => setTimeout(() => {
                console.log('[Coordinator] Timeout waiting for root node, will create a new one');
                resolve(null);
            }, 5000))
        ]);

        // If root node doesn't exist, create it
        if (!this.rootNode) {
            console.log('[Coordinator] Root node not found, creating new root node with name:', this.name);
            
            this.rootNode = await TreeNode.create(this.name, {
                id: this.rootId,
                points: 0,
                manualFulfillment: null
            }, this as unknown as any);
            
            console.log('[Coordinator] New root node created with ID:', this.rootNode.id);
        } else {
            console.log('[Coordinator] Existing root node loaded successfully:', {
                id: this.rootNode.id,
                name: this.rootNode.name
            });
            
            // Update name if needed
            if ((this.rootNode.name === '' || this.rootNode.name === 'Unnamed') && this.name) {
                console.log('[Coordinator] Updating root node name to match user name:', this.name);
                this.rootNode.name = this.name;
            }
        }

        // Create user reference and update profile
        console.log('[Coordinator] Creating user reference in users path:', this.rootId);
        updateUserProfile(this.rootId, this.name);
        gun.get('users').get(this.rootId).get('node').put(gun.get('nodes').get(this.rootId));
        
        // Setup periodic profile updates
        this.saveInterval = setInterval(() => {
            updateUserProfile(this.rootId, this.name);
        }, 60000);
    }
    
    /**
     * Initialize example data if needed
     */
    private async initializeExampleDataIfNeeded(): Promise<void> {
        if (!this.rootNode) return;
        
        // Wait for children to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check for children
        const hasChildren = this.rootNode.children.size > 0;
        
        if (!hasChildren) {
            console.log('[Coordinator] No children found, initializing example data');
            await initializeExampleData(this.rootNode as any);
            console.log('[Coordinator] Example data initialization complete');
        } else {
            console.log('[Coordinator] Root node already has children, skipping example data');
        }
    }
    
    /**
     * Register a Svelte component
     */
    registerComponent(type: 'treemap' | 'piechart', component: SvelteComponent): void {
        if (type === 'treemap') {
            this.treeMapComponent = component;
        } else if (type === 'piechart') {
            this.pieChartComponent = component;
        }
    }
    
    /**
     * Unregister a Svelte component
     */
    unregisterComponent(type: 'treemap' | 'piechart'): void {
        if (type === 'treemap') {
            this.treeMapComponent = null;
        } else if (type === 'piechart') {
            this.pieChartComponent = null;
        }
    }
    
    /**
     * Get the node store for a specific node
     * @param nodeId ID of the node
     * @returns Svelte store for the node or null if not found
     */
    getNodeStore(nodeId: string): NodeStore | null {
        // Check if we already have a store for this node
        if (this.nodeStoreMap.has(nodeId)) {
            return this.nodeStoreMap.get(nodeId)!;
        }
        
        // Try to get the node from the registry
        const node = TreeNode.getNode(nodeId, this as unknown as any);
        if (!node) return null;
        
        // Create a new store for this node
        const store = createNodeTreeStore(node);
        this.nodeStoreMap.set(nodeId, store);
        return store;
    }
    
    /**
     * Get a store for the root node
     */
    get rootStore(): Readable<NodeStore | null> {
        const store = writable<NodeStore | null>(this.rootNodeStore);
        
        // Update when initialization completes
        const unsubscribe = this.isInitialized.subscribe(initialized => {
            if (initialized && this.rootNodeStore) {
                store.set(this.rootNodeStore);
            }
        });
        
        // Return store with cleanup
        return {
            subscribe: store.subscribe,
            _cleanup: unsubscribe
        } as Readable<NodeStore | null>;
    }
    
    /**
     * Get a store that tracks initialization status
     */
    get initialized(): Readable<boolean> {
        return this.isInitialized;
    }
    
    /**
     * Get the root node
     */
    get root(): TreeNode | null {
        return this.rootNode;
    }
    
    /**
     * Get the current view
     */
    get currentView(): TreeNode | null {
        return this.rootNode;
    }
    
    /**
     * Clean up resources
     */
    destroy(): void {
        console.log('[Coordinator] Destroying Coordinator instance');
        
        // Clean up components
        if (this.treeMapComponent) {
            this.treeMapComponent.$destroy();
            this.treeMapComponent = null;
        }
        
        if (this.pieChartComponent) {
            this.pieChartComponent.$destroy();
            this.pieChartComponent = null;
        }
        
        // Clean up node stores
        for (const store of this.nodeStoreMap.values()) {
            store.dispose();
        }
        this.nodeStoreMap.clear();
        this.rootNodeStore = null;
        
        // Stop save interval
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }
        
        // Clean up subscriptions
        this._subscriptions.forEach(unsub => {
            try {
                unsub();
            } catch (err) {
                console.error('[Coordinator] Error in subscription cleanup:', err);
            }
        });
        this._subscriptions = [];
        
        console.log('[Coordinator] Coordinator instance destroyed');
    }
}