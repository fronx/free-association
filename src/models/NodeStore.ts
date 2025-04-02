import { writable, derived, get } from 'svelte/store';
import type { Writable, Readable } from 'svelte/store';
import type { TreeNode } from './ReactTreeNode';

/**
 * Creates a Svelte store from a ReactTreeNode's reactive property.
 * The store will be updated whenever the property changes.
 * 
 * @param node The ReactTreeNode instance
 * @param propertyName Name of the reactive property on the node
 * @returns A readable Svelte store that updates when the node property changes
 */
export function createNodePropertyStore<T>(node: TreeNode, propertyName: string): Readable<T> {
  const store = writable<T>(node[propertyName] as unknown as T);
  
  // Set up subscription to the node's property
  // Try to get the property stream - first try as reactive, then as computed
  let unsubscribe: () => void;
  
  try {
    // First try as a reactive property
    // Use any to bypass TypeScript's strict property name checking
    // This is safe because we're handling errors if the property doesn't exist
    const stream = (node as any).getPropertyStream(propertyName);
    unsubscribe = stream.on((value: any) => {
      store.set(value as unknown as T);
    });
  } catch (error) {
    try {
      // Then try as a computed property
      const stream = node.getComputedStream<T>(propertyName);
      unsubscribe = stream.on((value: any) => {
        store.set(value as unknown as T);
      });
    } catch (error) {
      console.error(`Property ${propertyName} not found as reactive or computed:`, error);
      // Create a fallback that just returns the current value
      unsubscribe = () => {}; // Empty cleanup function
    }
  }
  
  // Enhanced store with cleanup
  return {
    subscribe: store.subscribe,
    // Add ability to check cleanup on the store object itself
    _cleanup: unsubscribe
  } as Readable<T>;
}

/**
 * Creates a store for a TreeNode that automatically
 * handles subscriptions to its properties.
 */
export class NodeStore {
  private node: TreeNode;
  private stores: Map<string, Readable<any>> = new Map();
  private childStores: Map<string, NodeStore> = new Map();
  private unsubscribers: Map<string, () => void> = new Map();
  
  /**
   * Create a NodeStore for a TreeNode
   * @param node The ReactTreeNode to wrap in a store
   */
  constructor(node: TreeNode) {
    this.node = node;
    
    // Set up subscription to children changes
    this.setupChildrenSubscription();
  }
  
  /**
   * Get a store for a specific property of the node
   * @param propertyName Name of the property
   * @returns A readable store for the property
   */
  property<T>(propertyName: string): Readable<T> {
    if (!this.stores.has(propertyName)) {
      const store = createNodePropertyStore<T>(this.node, propertyName);
      this.stores.set(propertyName, store);
    }
    
    return this.stores.get(propertyName) as Readable<T>;
  }
  
  /**
   * Watch for changes to the node's children
   */
  private setupChildrenSubscription(): void {
    // Initial setup of child stores
    this.updateChildStores();
    
    // Subscribe to children changes
    const childrenStream = this.node.getComputedStream<Map<string, TreeNode>>('children');
    if (childrenStream) {
      const unsubscribe = childrenStream.on(() => {
        this.updateChildStores();
      });
      
      this.unsubscribers.set('children', unsubscribe);
    }
  }
  
  /**
   * Update the child stores based on current children
   */
  private updateChildStores(): void {
    const currentChildren = this.node.children;
    const currentChildIds = new Set(currentChildren.keys());
    
    // Remove stores for children that no longer exist
    for (const [childId, childStore] of this.childStores.entries()) {
      if (!currentChildIds.has(childId)) {
        childStore.dispose();
        this.childStores.delete(childId);
      }
    }
    
    // Add stores for new children
    for (const [childId, childNode] of currentChildren.entries()) {
      if (!this.childStores.has(childId)) {
        this.childStores.set(childId, new NodeStore(childNode));
      }
    }
  }
  
  /**
   * Get a store for a child node
   * @param childId ID of the child node
   * @returns NodeStore for the child, or null if not found
   */
  child(childId: string): NodeStore | null {
    return this.childStores.get(childId) || null;
  }
  
  /**
   * Get a store containing all children
   * @returns A readable store with the map of child nodes
   */
  get children(): Readable<Map<string, NodeStore>> {
    const childrenStore = writable(new Map(this.childStores));
    
    // Set up subscription to children changes
    const unsubscribe = this.property<Map<string, TreeNode>>('children').subscribe(() => {
      childrenStore.set(new Map(this.childStores));
    });
    
    // Return derived store that includes cleanup
    return {
      subscribe: childrenStore.subscribe,
      _cleanup: unsubscribe
    } as Readable<Map<string, NodeStore>>;
  }
  
  /**
   * Get the wrapped node
   */
  get nodeRef(): TreeNode {
    return this.node;
  }
  
  /**
   * Clean up all subscriptions
   */
  dispose(): void {
    // Clean up property stores
    for (const store of this.stores.values()) {
      if (store['_cleanup']) {
        store['_cleanup']();
      }
    }
    this.stores.clear();
    
    // Clean up children subscriptions
    for (const unsubscribe of this.unsubscribers.values()) {
      unsubscribe();
    }
    this.unsubscribers.clear();
    
    // Clean up child stores
    for (const childStore of this.childStores.values()) {
      childStore.dispose();
    }
    this.childStores.clear();
  }
}

/**
 * Create a store that aggregates values from a collection of node stores
 * Similar to the SumScheduler example in the svelte-stores documentation
 */
export class NodeAggregator<T, R> {
  private resultStore = writable<R>(null as unknown as R);
  private nodeMap = new Map<string, Readable<T>>();
  private aggregateFunction: (values: T[]) => R;
  
  /**
   * Create a NodeAggregator
   * @param aggregateFunction Function to aggregate values from individual nodes
   * @param initialValue Initial result value
   */
  constructor(aggregateFunction: (values: T[]) => R, initialValue?: R) {
    this.aggregateFunction = aggregateFunction;
    
    if (initialValue !== undefined) {
      this.resultStore.set(initialValue);
    }
  }
  
  /**
   * Add a node store to the aggregator
   * @param id Unique identifier for the store
   * @param store Store to add
   * @returns Function to remove the store
   */
  add(id: string, store: Readable<T>): () => void {
    this.nodeMap.set(id, store);
    
    // Subscribe to the store and update when it changes
    const unsubscribe = store.subscribe(() => {
      this.update();
    });
    
    // Initial update
    this.update();
    
    // Return function to remove this store
    return () => {
      unsubscribe();
      this.nodeMap.delete(id);
      this.update();
    };
  }
  
  /**
   * Update the result store with the aggregated value
   */
  private update(): void {
    const values = Array.from(this.nodeMap.values()).map(store => get(store));
    const result = this.aggregateFunction(values);
    this.resultStore.set(result);
  }
  
  /**
   * Get the result store
   */
  get result(): Readable<R> {
    return this.resultStore;
  }
  
  /**
   * Clean up all subscriptions
   */
  dispose(): void {
    this.nodeMap.clear();
  }
}

/**
 * Create a store for a tree of nodes, automatically handling children recursively
 * @param rootNode Root ReactTreeNode
 * @returns NodeStore for the entire tree
 */
export function createNodeTreeStore(rootNode: TreeNode): NodeStore {
  return new NodeStore(rootNode);
} 