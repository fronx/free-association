import { gun } from './Gun';
import { App } from '../App';
import { GunSubscription } from './GunSubscription';
import { GunNode } from './GunNode';
import { Reactive, ReactiveEntity, ComputationCache } from './Reactive'

/**
 * Interface describing the data structure of a tree node
 */
export interface TreeNodeData {
id: string;
name: string;
points: number;
manualFulfillment: number | null;
parent?: string;
}

/**
 * A reactive tree node with automatic dependency tracking
 */
export class TreeNode extends ReactiveEntity<TreeNodeData> {
  // Registry to keep track of all nodes
  private static _registry = new Map<string, TreeNode>();
  
  // Cache for shares calculations
  private static _sharesCache = new ComputationCache<string, {[key: string]: number}>(
    (nodeId: string) => {
      const node = TreeNode._registry.get(nodeId);
      return node ? node.calculateShares() : {};
    }
  );
  
  // Instance properties
  private _parent: TreeNode | null = null;
  private _children = new Reactive<Map<string, TreeNode>>(new Map());
  private _types = new Reactive<Set<string>>(new Set());
  
  // Type index to find nodes by type
  private _typeIndex = new Map<string, Set<string>>();
  
  // Track recognition from other nodes
  private _sharesOfOthersRecognition = new Reactive<{[key: string]: number}>({});
  
  // TreeNode-specific ID (redundant with parent class, but needed for access)
  protected _nodeId: string;
  
  // TypeScript property declarations for reactive/computed properties
  declare public isRoot: boolean;
  declare public root: TreeNode;
  declare public isContributor: boolean;
  declare public isContribution: boolean;
  declare public totalChildPoints: number;
  declare public weight: number;
  declare public shareOfParent: number;
  declare public hasDirectContributionChild: boolean;
  declare public hasNonContributionChild: boolean;
  declare public contributionChildrenWeight: number;
  declare public contributionChildrenFulfillment: number;
  declare public nonContributionChildrenFulfillment: number;
  declare public fulfilled: number;
  declare public desire: number;
  declare public fulfillmentWeight: number;
  declare public shares: {[key: string]: number};
  
  // Data properties
  declare public name: string;
  declare public points: number;
  declare public manualFulfillment: number | null;
  
  /**
   * Get or create a TreeNode instance
   */
  public static getNode(id: string, app: App): TreeNode {
    // Check if we already have this node
    let node = TreeNode._registry.get(id);
    
    // Create a new node if needed
    if (!node) {
      node = new TreeNode(id, app);
      TreeNode._registry.set(id, node);
    }
    
    return node;
  }
  
  /**
   * Create a new TreeNode and persist it to the database
   */
  public static async create(
    name: string,
    options: {
      parent?: TreeNode,
      points?: number,
      manualFulfillment?: number | null,
      typeIds?: string[],
      id?: string
    } = {},
    app: App
  ): Promise<TreeNode> {
    // Generate an ID if none is provided
    const id = options.id || crypto.randomUUID();
    
    // Create the node data
    const data: TreeNodeData = {
      id,
      name,
      points: options.points ?? 0,
      manualFulfillment: options.manualFulfillment ?? null
    };
    
    // Set parent if provided
    if (options.parent) {
      data.parent = options.parent.id;
    }
    
    // Get or create the node
    const node = TreeNode.getNode(id, app);
    
    // Store the data in Gun
    await node.gunNode.put(data);
    
    // Set properties
    node.name = name;
    node.points = options.points ?? 1;
    node.manualFulfillment = options.manualFulfillment ?? 1;
    
    // Set parent
    if (options.parent) {
      await node.updateParent(options.parent.id);
    }
    
    // Add types
    if (options.typeIds && options.typeIds.length > 0) {
      for (const typeId of options.typeIds) {
        node.addType(typeId);
      }
    }
    
    return node;
  }
  
  /**
   * Private constructor - use getNode or create instead
   */
  private constructor(id: string, app: App) {
    super(id, app);
    this._nodeId = id;
    
    // Set up data properties
    this.defineReactiveProperty('name', '', ['nodes', id, 'name']);
    this.defineReactiveProperty('points', 1, ['nodes', id, 'points']);
    this.defineReactiveProperty('manualFulfillment', 1, ['nodes', id, 'manualFulfillment']);
    
    // Set up computed properties related to tree structure
    this.defineComputedProperty('isRoot', () => this._parent === null);
    this.defineComputedProperty('root', () => this.isRoot ? this : this._parent!.root);
    
    // Add missing computed property for children
    this.defineComputedProperty('children', () => this._children.value);
    
    // Set up computed properties related to contributions
    this.defineComputedProperty('isContributor', () => this.points > 0);
    this.defineComputedProperty('isContribution', () => this._parent !== null && this.isContributor);
    
    // Set up computed properties for weights and fulfillment
    this.defineComputedProperty('totalChildPoints', () => {
      let total = 0;
      for (const child of this._children.value.values()) {
        if (child.isContributor) {
          total += child.points;
        }
      }
      return total;
    });
    
    this.defineComputedProperty('weight', () => {
      if (!this.isContributor) return 0;
      return this.points / (this.root.totalChildPoints || 1);
    });
    
    this.defineComputedProperty('shareOfParent', () => {
      if (!this._parent || !this.isContributor) return 0;
      return this.points / (this._parent.totalChildPoints || 1);
    });
    
    this.defineComputedProperty('hasDirectContributionChild', () => {
      for (const child of this._children.value.values()) {
        if (child.isContributor) return true;
      }
      return false;
    });
    
    this.defineComputedProperty('hasNonContributionChild', () => {
      for (const child of this._children.value.values()) {
        if (!child.isContributor) return true;
      }
      return false;
    });
    
    this.defineComputedProperty('contributionChildrenWeight', () => {
      let total = 0;
      for (const child of this._children.value.values()) {
        if (child.isContributor) {
          total += child.weight;
        }
      }
      return total;
    });
    
    this.defineComputedProperty('contributionChildrenFulfillment', () => {
      let total = 0;
      for (const child of this._children.value.values()) {
        if (child.isContributor) {
          total += child.fulfilled * child.shareOfParent;
        }
      }
      return total;
    });
    
    this.defineComputedProperty('nonContributionChildrenFulfillment', () => {
      let total = 0;
      for (const child of this._children.value.values()) {
        if (!child.isContributor) {
          total += child.fulfilled;
        }
      }
      return total;
    });
    
    this.defineComputedProperty('fulfilled', () => {
      // If we have a manual fulfillment set, use that
      if (this.manualFulfillment !== null) {
        return this.manualFulfillment;
      }
      
      // If no parent, use contribution children fulfillment
      if (!this._parent) {
        return this.contributionChildrenFulfillment;
      }
      
      // For contributors, fulfillment comes from parent and children
      if (this.isContributor) {
        const fromParent = this._parent.fulfilled * this.shareOfParent;
        const fromChildren = this.contributionChildrenFulfillment;
        return Math.max(fromParent, fromChildren);
      }
      
      // For non-contributors, use parent's fulfillment
      return this._parent.fulfilled;
    });
    
    this.defineComputedProperty('desire', () => {
      return this.points;
    });
    
    this.defineComputedProperty('fulfillmentWeight', () => {
      return this.weight;
    });
    
    this.defineComputedProperty('shares', () => {
      return this.root === this ? this.calculateShares() : this.root.shares;
    });
    
    // Set up subscriptions to Gun data
    this.setupSubscriptions();
  }
  
  /**
   * Set up subscriptions to Gun data
   */
  private setupSubscriptions(): void {
    // Subscribe to children
    this.subscribeToChildren();
    
    // Subscribe to types
    this.subscribeToTypes();
    
    // Listen to our own parent property
    const parentSub = this.gunNode.get('parent').stream();
    const subscription = parentSub.on(async (parentId) => {
      if (parentId && typeof parentId === 'string') {
        await this.updateParent(parentId);
      } else if (parentId === null || parentId === undefined) {
        await this.updateParent(null);
      }
    });
    
    // Store subscription for cleanup
    this.addSubscription(subscription);
    
    // Set up recognition subscriptions when types change
    this._types.subscribe(() => {
      this.setupRecognitionSubscriptions();
    });
  }
  
  /**
   * Subscribe to children of this node
   */
  private subscribeToChildren(): void {
    // Path to child nodes of this node
    const childrenPath = ['nodes', this._nodeId, 'children'];
    
    // Create a GunNode for the children
    const childrenNode = new GunNode(childrenPath);
    
    // Get a subscription to each child
    const childrenSub = childrenNode.stream().each();
    
    // Subscribe to updates
    const subscription = childrenSub.on(async (data) => {
      // Skip Gun metadata and null/undefined
      if (!data || typeof data !== 'object') return;
      
      // Check if this is a removal event
      if (data._removed) {
        // Remove child from the map
        const childMap = new Map(this._children.value);
        childMap.delete(data._key);
        this._children.value = childMap;
        return;
      }
      
      // Get the child ID
      const childId = data._key;
      
      // Get or create the child node
      const childNode = TreeNode.getNode(childId, this._app);
      
      // Update the children map
      const childMap = new Map(this._children.value);
      childMap.set(childId, childNode);
      this._children.value = childMap;
      
      // Make sure child knows about its parent
      await childNode.updateParent(this._nodeId);
    });
    
    // Store subscription for cleanup
    this.addSubscription(subscription);
  }
  
  /**
   * Subscribe to types of this node
   */
  private subscribeToTypes(): void {
    // Path to type nodes of this node
    const typesPath = ['nodes', this._nodeId, 'types'];
    
    // Create a GunNode for the types
    const typesNode = new GunNode(typesPath);
    
    // Get a subscription to each type
    const typesSub = typesNode.stream().each();
    
    // Subscribe to updates
    const subscription = typesSub.on((data) => {
      // Skip Gun metadata and null/undefined
      if (!data || typeof data !== 'object') return;
      
      // Check if this is a removal event
      if (data._removed) {
        // Remove type from the set
        const typeSet = new Set(this._types.value);
        typeSet.delete(data._key);
        this._types.value = typeSet;
        
        // Update type indices
        this.removeFromTypeIndex(data._key, this._nodeId);
        return;
      }
      
      // Get the type ID
      const typeId = data._key;
      
      // Update the types set
      const typeSet = new Set(this._types.value);
      typeSet.add(typeId);
      this._types.value = typeSet;
      
      // Update type indices
      this.addToTypeIndex(typeId, this._nodeId);
    });
    
    // Store subscription for cleanup
    this.addSubscription(subscription);
  }
  
  /**
   * Set up recognition subscriptions
   */
  private setupRecognitionSubscriptions(): void {
    if (this._parent) {
      console.warn('setupRecognitionSubscriptions called on non-root node');
      return;
    }
    
    // Get all types in the tree
    const relevantTypes = this.getAllTreeTypes();
    
    // Subscribe to shares for each type
    relevantTypes.forEach(typeId => {
      const sharesSub = new GunSubscription(['nodes', typeId, 'sharesOfGeneralFulfillment']);
      
      this.addSubscription(sharesSub.on((shares) => {
        if (!shares) return;
        
        // Extract valid numeric shares
        const validShares = Object.entries(shares)
          .filter(([_, value]) => typeof value === 'number')
          .map(([key, value]) => [key, value as number] as const);
        
        // Calculate sum for normalization
        const sum = validShares.reduce((acc, [_, val]) => acc + val, 0);
        
        // If we have valid shares, normalize and store our share if present
        if (sum > 0) {
          // Find our share
          const ourShare = validShares.find(([key, _]) => key === this._nodeId);
          
          if (ourShare) {
            const currentShares = {...this._sharesOfOthersRecognition.value};
            currentShares[typeId] = ourShare[1] / sum;
            this._sharesOfOthersRecognition.value = currentShares;
            
            // NOTE: UI updates will now be triggered via the stream subscription
            // when _sharesOfOthersRecognition changes
            // But we'll keep these lines for now until the UI update stream is fully integrated
            this._app.updateNeeded = true;
            this._app.pieUpdateNeeded = true;
          }
        }
      }));
    });
  }
  
  /**
   * Get all types used in the tree
   */
  private getAllTreeTypes(): Set<string> {
    const types = new Set<string>();
    
    const collectTypes = (node: TreeNode) => {
      // Add node's types
      node._types.value.forEach(typeId => types.add(typeId));
      
      // Process children
      node._children.value.forEach(child => collectTypes(child));
    };
    
    collectTypes(this);
    return types;
  }
  
  /**
   * Update parent reference
   */
  private async updateParent(parentId: string | null): Promise<void> {
    // Handle old parent
    if (this._parent) {
      const oldParentChildren = new Map(this._parent._children.value);
      oldParentChildren.delete(this._nodeId);
      this._parent._children.value = oldParentChildren;
    }
    
    // Set new parent
    if (parentId) {
      const parentNode = TreeNode.getNode(parentId, this._app);
      this._parent = parentNode;
      
      // Add to new parent's children
      const newParentChildren = new Map(parentNode._children.value);
      newParentChildren.set(this._nodeId, this);
      parentNode._children.value = newParentChildren;
    } else {
      this._parent = null;
    }
    
    // NOTE: UI updates will now be triggered via the stream subscription
    // when _parent, _children, or related computed properties change
    // But we'll keep these lines for now until the UI update stream is fully integrated
    this._app.updateNeeded = true;
    this._app.pieUpdateNeeded = true;
  }

  get parent(): TreeNode | null {
    return this._parent;
  }
  
  /**
   * Get types
   */
  get types(): Set<string> {
    return new Set(this._types.value);
  }
  
  /**
   * Get children
   */
  get children(): Map<string, TreeNode> {
    return new Map(this._children.value);
  }
  
  /**
   * Get shares of recognition from other nodes
   */
  get sharesOfOthersRecognition(): {[key: string]: number} {
    return {...this._sharesOfOthersRecognition.value};
  }
  
  /**
   * Calculate shares for all types
   */
  private calculateShares(): {[key: string]: number} {
    // Get all type IDs from index
    const typeIds = Array.from(this._typeIndex.keys());
    
    // Calculate shares for each type
    const shares = typeIds.map(typeId => ({
      typeId,
      value: this.calculateShareOfType(typeId)
    }));
    
    // Calculate total for normalization
    const total = shares.reduce((sum, { value }) => sum + value, 0);
    
    // Convert to normalized object
    return shares.reduce((obj, { typeId, value }) => ({
      ...obj,
      [typeId]: total > 0 ? value / total : 0
    }), {});
  }
  
  /**
   * Calculate share of a specific type
   */
  private calculateShareOfType(typeId: string): number {
    // Get all instances of this type
    const instances = this.getInstances(typeId);
    
    // Calculate total recognition
    return Array.from(instances)
      .map(id => TreeNode._registry.get(id))
      .filter((node): node is TreeNode => node !== undefined)
      .reduce((sum, instance) => sum + this.recognitionOf(instance), 0);
  }
  
  /**
   * Calculate recognition of a specific instance
   */
  private recognitionOf(instance: TreeNode): number {
    const fulfillmentWeight = instance.fulfilled * instance.weight;
    const contributorCount = instance._types.value.size;
    return contributorCount > 0
      ? fulfillmentWeight / contributorCount
      : fulfillmentWeight;
  }
  
  /**
   * Calculate mutual fulfillment with a type
   */
  public mutualFulfillment(typeId: string): number {
    const recognitionFromHere = this.calculateShareOfType(typeId);
    const recognitionFromThere = this._sharesOfOthersRecognition.value[typeId] || 0;
    return Math.min(recognitionFromHere, recognitionFromThere);
  }
  
  /**
   * Get the distribution of mutual fulfillment across types
   */
  get mutualFulfillmentDistribution(): Map<string, number> {
    const types = Array.from(this._typeIndex.keys()).filter(typeId => 
      this.getInstances(typeId).size > 0
    );
    
    const rawDistribution = types
      .map(typeId => ({
        typeId,
        value: this.mutualFulfillment(typeId)
      }))
      .filter(entry => entry.value > 0);
    
    const total = rawDistribution.reduce((sum, entry) => sum + entry.value, 0);
    
    return new Map(
      rawDistribution.map(entry => [
        entry.typeId,
        total > 0 ? entry.value / total : 0
      ])
    );
  }
  
  /**
   * Add a type to this node
   */
  public addType(typeId: string): TreeNode {
    if (!this._types.value.has(typeId)) {
      // Remove all children first
      for (const [childId] of this._children.value) {
        this.removeChild(childId);
      }

      // Add to types set
      const types = new Set(this._types.value);
      types.add(typeId);
      this._types.value = types;
      
      // Add to type index
      this.root.addToTypeIndex(typeId, this._nodeId);
      
      // Update in Gun
      gun.get('nodes').get(this._nodeId).get('types').get(typeId).put(true);
      
      // Update recognition subscriptions
      if (this.isRoot) {
        this.setupRecognitionSubscriptions();
      }
    }
    
    return this;
  }
  
  /**
   * Remove a type from this node
   */
  public removeType(typeId: string): TreeNode {
    if (this._types.value.has(typeId)) {
      // Remove from types set
      const types = new Set(this._types.value);
      types.delete(typeId);
      this._types.value = types;
      
      // Remove from type index
      this.root.removeFromTypeIndex(typeId, this._nodeId);
      
      // Update in Gun
      gun.get('nodes').get(this._nodeId).get('types').get(typeId).put(null);
      
      // Update recognition subscriptions
      if (this.isRoot) {
        this.setupRecognitionSubscriptions();
      }
    }
    
    return this;
  }
  
  /**
   * Add a child node
   */
  public async addChild(
    name: string,
    points: number = 0,
    typeIds: string[] = [],
    manualFulfillment: number | null = null,
    id?: string
  ): Promise<TreeNode> {
    // Check if this node can have children
    if (this._parent && this.isContribution) {
      throw new Error(`Node ${this.name} is a contribution and cannot have children`);
    }
    
    // Create child node
    const child = await TreeNode.create(name, {
      parent: this,
      points,
      manualFulfillment,
      typeIds,
      id
    }, this._app);
    
    // NOTE: UI updates will now be triggered via the stream subscription
    // when the child is added to _children
    // But we'll keep these lines for now until the UI update stream is fully integrated
    this._app.updateNeeded = true;
    this._app.pieUpdateNeeded = true;
    
    return child;
  }
  
  /**
   * Remove a child node
   */
  public removeChild(childId: string): TreeNode {
    if (this._children.value.has(childId)) {
      // Remove from Gun
      gun.get('nodes').get(this._nodeId).get('children').get(childId).put(null);
    }
    
    return this;
  }
  
  /**
   * Add a node to the type index
   */
  public addToTypeIndex(typeId: string, nodeId: string): void {
    if (!this._typeIndex.has(typeId)) {
      this._typeIndex.set(typeId, new Set<string>());
    }
    
    this._typeIndex.get(typeId)!.add(nodeId);
  }
  
  /**
   * Remove a node from the type index
   */
  public removeFromTypeIndex(typeId: string, nodeId: string): void {
    if (this._typeIndex.has(typeId)) {
      this._typeIndex.get(typeId)!.delete(nodeId);
    }
  }
  
  /**
   * Get all instances of a given type
   */
  public getInstances(typeId: string): Set<string> {
    return this.root._typeIndex.get(typeId) || new Set();
  }
  
  /**
   * Get all types in the system
   */
  get rootTypes(): string[] {
    return Array.from(this.root._typeIndex.keys());
  }
  
  /**
   * Dispose of resources and unregister this node
   */
  dispose(): void {
    super.dispose();
    
    // Remove from registry
    TreeNode._registry.delete(this._nodeId);
  }

    /**
   * Create a stream that emits UI update requirements
   * This replaces manual setting of App.updateNeeded and App.pieUpdateNeeded flags
   * @returns A subscription that emits UI update requirements whenever node data changes
   */
    public getUIUpdateStream(): GunSubscription<{ updateNeeded: boolean, pieUpdateNeeded: boolean }> {
      // Create a custom GunSubscription that tracks multiple properties
      return {
        on: (handler: (updates: { updateNeeded: boolean, pieUpdateNeeded: boolean }) => void) => {
          const cleanups: (() => void)[] = [];
          
          // Track properties that affect visualization
          const reactiveProps = ['name', 'points', 'manualFulfillment'];
          const computedProps = ['isRoot', 'weight', 'fulfilled', 'shares', 'totalChildPoints', 'shareOfParent'];
          
          // Subscribe to reactive property changes
          reactiveProps.forEach(prop => {
            if (this._reactives.has(prop)) {
              const reactive = this._reactives.get(prop);
              const cleanup = reactive!.subscribe(() => {
                handler({ updateNeeded: true, pieUpdateNeeded: true });
              });
              cleanups.push(cleanup);
            }
          });
          
          // Subscribe to computed property changes
          computedProps.forEach(prop => {
            if (this._computed.has(prop)) {
              const computed = this._computed.get(prop);
              const cleanup = computed!.subscribe(() => {
                handler({ updateNeeded: true, pieUpdateNeeded: true });
              });
              cleanups.push(cleanup);
            }
          });
          
          // Subscribe to children changes
          const childrenCleanup = this._children.subscribe(() => {
            handler({ updateNeeded: true, pieUpdateNeeded: true });
          });
          cleanups.push(childrenCleanup);
          
          // Subscribe to types changes
          const typesCleanup = this._types.subscribe(() => {
            handler({ updateNeeded: true, pieUpdateNeeded: true });
          });
          cleanups.push(typesCleanup);
          
          // Subscribe to shares recognition changes
          const sharesCleanup = this._sharesOfOthersRecognition.subscribe(() => {
            handler({ updateNeeded: true, pieUpdateNeeded: true });
          });
          cleanups.push(sharesCleanup);
          
          // Return a single cleanup function that handles all subscriptions
          return () => {
            cleanups.forEach(cleanup => cleanup());
          };
        }
      } as GunSubscription<{ updateNeeded: boolean, pieUpdateNeeded: boolean }>;
    }
  
  /**
   * Clean up all registered nodes
   */
  public static cleanup(): void {
    // Dispose all nodes
    TreeNode._registry.forEach(node => node.dispose());
    TreeNode._registry.clear();
    
    // Clear caches
    TreeNode._sharesCache.clear();
  }
}