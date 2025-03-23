import { App } from '../App';
import { readFromGunPath } from './FuncGun';
import { gun } from './Gun';

// we get duplicate types! on our nodes! (lets use Sets!)
// But why do we get this in the first place?
// Every time we reload the page, we repeat adding all the same types!

// Are our nodes saving to the gun-space or the user-space
// Late: From public to user-spaces (so that overwriting is not possible)

// How do we now test for multiple users?

// We woudln't just reproduce their state in our cache?

// Create a tree for all those we recognize and subscribe to their changes so that we can calculate mutual-recognition

// So we know we need to mantain in our own cache, the trees of:
// - All nodes we recognize
// THAT IS IT.

// It seems like something is causing growing touch to stop mid-touch.

// we need to use gun.unset (for our unique sets!)

export class TreeNode {
    id: string;
    private _name: string = '';
    private _points: number = 0;
    private gunRef: any;
    // pointCache: number = 0;
    private _parent: TreeNode | null;
    children: Map<string, TreeNode> = new Map();
    private _manualFulfillment: number | null = null;
    // fulfillmentCache: number = 0;
    
    // Store types in a Map with ID as key to prevent duplicates
    private _typesMap: Map<string, TreeNode> = new Map();
    typeIndex: Map<TreeNode, Set<TreeNode>>;
    app: App;
    
    // Gun subscription references
    private nodeSubscription: any;
    private childrenSubscription: any;
    private typesSubscription: any;
    
    // Static reference cache to avoid duplicating Gun references
    private static gunRefCache: Map<string, any> = new Map();
    
    // Helper to get a Gun reference and cache it
    static getGunRef(id: string): any {
        if (!this.gunRefCache.has(id)) {
            console.log(`[TreeNode] Creating new Gun reference for node ${id}`);
            this.gunRefCache.set(id, gun.get('nodes').get(id));
        }
        return this.gunRefCache.get(id);
    }
    
    constructor(name: string, id?: string, parent: TreeNode | null = null, types: TreeNode[] = [], manualFulfillment: number = 0, points: number = 0) {
      this._name = name;
      this.id = id || Math.random().toString(36).substring(2, 15);
      this._parent = parent;
      this._manualFulfillment = manualFulfillment || null;
      this._points = points;
      this.app = (window as any).app;
      this.gunRef = TreeNode.getGunRef(this.id);
      
      // Map of type -> Set of instances (shared at root level)
      this.typeIndex = parent ? parent.root.typeIndex : new Map();
  
      // Initialize _typesMap with passed types, indexed by ID
      if (types.length > 0) {
        // Create a map of type ID to type
        types.forEach(type => {
          if (type && type.id) {
            this._typesMap.set(type.id, type);
            // Don't need to call addType here since we're just initializing
          }
        });
        
        // Now add each type to Gun
        Array.from(this._typesMap.values()).forEach(type => {
          this.addType(type);
        });
      }
      
      // If this is a new node with manual fulfillment, update in Gun
      if (!id && this._manualFulfillment !== null) {
        console.log(`[TreeNode] Setting initial manual fulfillment for ${this.name} to ${this._manualFulfillment}`);
        this.gunRef.get('manualFulfillment').put(this._manualFulfillment);
      }
      
      // If this is a new node with points, update in Gun
      if (!id && this._points > 0) {
        console.log(`[TreeNode] Setting initial points for ${this.name} to ${this._points}`);
        this.gunRef.get('points').put(this._points);
      }
      
      // If this is a new node, persist it to Gun
      if (!id) {
        this.saveToGun();
      }
      
      // Set up subscriptions
      this.setupSubscriptions();
    }

    get name(): string {
      return this._name;
    }
    
    set name(name: string) {
      console.log(`[TreeNode] Setting name for node ${this.id} to ${name}`);
      this._name = name;
      
      // Update in Gun using direct approach
      this.gunRef.get('name').put(name);
      
      this.app.updateNeeded = true;
    }

    get root(): TreeNode {
      return this._parent ? this._parent.root : this;
    }
    
    get parent(): TreeNode | null {
      return this._parent;
    }

    set parent(parent: TreeNode | null) {
      this._parent = parent
      if (parent) {
        // Use Gun's direct reference operation
        const parentRef = gun.get('nodes').get(parent.id);
        this.gunRef.get('parent').put(parentRef);
      } else {
        // If parent is null, remove the reference
        this.gunRef.get('parent').put(null);
      }
    }   
    // Helper method to get all types in the system
    get rootTypes(): TreeNode[] {
      return Array.from(this.root.typeIndex.keys());
    }

    get isContributor() : boolean {
      return !this._parent
      // will be changed with Gun logic!
    }
    
    get isContribution(): boolean {
      // A node is a contribution if it has any types that are contributors
      if (this._typesMap.size === 0) return false;
      return Array.from(this._typesMap.values()).some(type => type.isContributor);
    }
  
    async addChild(name: string, points: number = 0, typeIds: string[] = [], manualFulfillment: number = 0,): Promise<TreeNode> {
      if (this._parent && this.isContribution) {
        throw new Error(
          `Node ${this.name} is an instance of a contributor/contribution and cannot have children.`
        );
      }
  
      // Create child data
      const childData = {
        name: name,
        points: points,
        manualFulfillment: manualFulfillment || null
      };
      
      console.log(`[TreeNode] Creating child node "${name}"`);
      
      // Step 1: Create node directly in Gun's 'nodes' collection
      // Let Gun generate the soul (ID) automatically
      const childNodeRef = gun.get('nodes').set(childData);
      
      // Step 2: Wait for Gun to generate the soul
      const childId = await new Promise<string>((resolve) => {
        childNodeRef.once((data, key) => {
          // Extract soul from metadata or use key
          const soul = data?._?.['#'] || key;
          console.log(`[TreeNode] Gun generated soul for child: ${soul}`);
          resolve(soul);
        });
      });
      
      // Step 3: Add reference to parent's children collection
      console.log(`[TreeNode] Adding child ${childId} to parent ${this.id}`);
        this.gunRef.get('children').set(childNodeRef);
      
      // Step 4: Create the TreeNode instance
      const child = new TreeNode(name, childId, this, [], manualFulfillment, points);
      
      // Step 5: Add to local children map
      this.children.set(childId, child);
      
      // Step 7: Add types by ID
      for (const typeId of typeIds) {
        child.addType(typeId);
      }
      
      this.app.updateNeeded = true;
      this.app.pieUpdateNeeded = true;      
      return child;
    }
  
    removeChild(childId: string): TreeNode {
      const child = this.children.get(childId);
      if (child) {        
        // Remove from type index
        this.root.typeIndex.forEach(instances => {
          instances.delete(child);
        });
        
        // Remove from children
        this.children.delete(childId);
        
        // Remove from Gun by removing the reference
        console.log(`[TreeNode] Removing child ${childId} from node ${this.id}`);
        
        // Get reference to child node
        const childRef = gun.get('nodes').get(childId);
        
        // Use Gun's native unset operation
        this.gunRef.get('children').get(childId).put(null);
        
        if (child.nodeSubscription && child.nodeSubscription.gunNodeRef) {
          child.unsubscribe();
        }
      }
      this.app.updateNeeded = true;
      this.app.pieUpdateNeeded = true;
      return this;
    }

    // Getter to return a Set of types for backward compatibility
    get types(): Set<TreeNode> {
      return new Set(this._typesMap.values());
    }
    
    // Add this node as an instance of the given type
    addType(typeOrId: TreeNode | string): TreeNode {
      const root = this.root;
      const typeId = typeof typeOrId === 'string' ? typeOrId : typeOrId.id;
      
      // If the type is already in our map, nothing to do
      if (this._typesMap.has(typeId)) {
        console.log(`[TreeNode] Type ${typeId} already exists for node ${this.name}`);
        return this;
      }
      
      // First get or load the type node
      const getTypeNode = async (): Promise<TreeNode | null> => {
        if (typeof typeOrId === 'string') {
          return TreeNode.fromId(typeOrId);
        }
        return typeOrId;
      };
      
      // Use Gun's native reference system
      console.log(`[TreeNode] Adding type ${typeId} to node ${this.name}`);
      
      // Get reference to type node
      const typeNodeRef = gun.get('nodes').get(typeId);
      
      // Add to types collection using Gun's put operation instead of set - this ensures persistence
      this.gunRef.get('types').get(typeId).put(typeNodeRef);
      
      // Asynchronously update the type index when we have the type node
      getTypeNode().then(typeNode => {
        if (typeNode) {
          // Add to local types map if not already present
          this._typesMap.set(typeId, typeNode);
          
          // Update type index
          if (!root.typeIndex.has(typeNode)) {
            root.typeIndex.set(typeNode, new Set());
          }
          root.typeIndex.get(typeNode)?.add(this);
        } else {
          console.error(`[TreeNode] Failed to get type node for ${typeId}`);
        }
      }).catch(err => {
        console.error(`[TreeNode] Error adding type ${typeId} to node ${this.name}:`, err);
      });
      
      this.app.updateNeeded = true;
      this.app.pieUpdateNeeded = true;
      
      return this;
    }
  
    removeType(typeOrId: TreeNode | string): TreeNode {
      const root = this.root;
      const typeId = typeof typeOrId === 'string' ? typeOrId : typeOrId.id;
      
      // Remove from Gun using native Gun operations
      console.log(`[TreeNode] Removing type ${typeId} from node ${this.name}`);
      
      // Use Gun's direct approach to remove the type reference
      this.gunRef.get('types').get(typeId).put(null);
      
      // If we have a TreeNode object, update the type index right away
      if (typeof typeOrId !== 'string') {
        const typeNode = typeOrId;
        if (root.typeIndex.has(typeNode)) {
          root.typeIndex.get(typeNode)?.delete(this);
        }
      }
      
      // Remove from local types map
      this._typesMap.delete(typeId);
      
      this.app.updateNeeded = true;
      this.app.pieUpdateNeeded = true;
      return this;
    }

    get points(): number {
      return this._points;
    }

    set points(points: number) {
      console.log(`[TreeNode] Setting points for ${this.name} to ${points}`);
      this._points = points;
      
      // Update in Gun using direct approach
      this.gunRef.get('points').put(points);
      
      this.app.pieUpdateNeeded = true;
    }
  
    get totalChildPoints() {
      return Array.from(this.children.values()).reduce((sum, child) => sum + child.points, 0) || 0;
    }
  
    get weight(): number {
      if (!this.parent) return 1;
      return this.parent.totalChildPoints === 0
        ? 0
        : (this._points / this._parent.totalChildPoints) * this._parent.weight;
    }
  
    // shareOfParent() -> how many points this node has, as fraction of totalChildPoints.
    // used to distribute contribution/fulfillment upward or across siblings.
    get shareOfParent(): number {
        if (!this.parent) return 1;
        return this.parent.totalChildPoints === 0
          ? 0
          : this._points / this._parent.totalChildPoints;
    }
  
    get hasDirectContributionChild(): boolean {
        return Array.from(this.children.values()).some(
          child => child.isContribution
        );
    }
      
    get hasNonContributionChild(): boolean {
        return Array.from(this.children.values()).some(
          child => !child.isContribution
        );
    }
  
    get contributionChildrenWeight(): number {
        const contributionPoints = Array.from(this.children.values())
          .filter(child => child.isContribution)
          .reduce((sum, child) => sum + child.points, 0);
  
        return contributionPoints / this.totalChildPoints;
    }
  
    get contributionChildrenFulfillment(): number {
        const contributionChildren = Array.from(this.children.values()).filter(
          child => child.isContribution
        );
  
        return contributionChildren.reduce(
          (sum, child) => sum + child.fulfilled * child.shareOfParent,
          0
        );
    }
  
    get nonContributionChildrenFulfillment(): number {
      const nonContributionChildren = Array.from(this.children.values()).filter(
          child => !child.isContribution
        );

      return nonContributionChildren.reduce(
          (sum, child) => sum + child.fulfilled * child.shareOfParent,
          0
        );
    }
      
    // The core method: fulfilled():
    // 1. Leaf nodes with isContribution == true → full 1.0 fulfillment
    // 2. Leaf nodes with isContribution == false → 0
    // 3. If _manualFulfillment is set and node has both contributor and non-contributor children:
    //    merges the manual fulfillment for contributor children with the calculated fulfillment for non-contributor children using a weighted approach.
    // 4. Otherwise falls back to summing child fulfillments * shareOfParent().
    get fulfilled(): number {
      // For leaf nodes (no children)
      if (this.children.size === 0) {
        return this.isContribution ? 1 : 0;
      }

      // If fulfillment was manually set and node has contributor children
      if (
        this._manualFulfillment !== null &&
        this.hasDirectContributionChild
      ) {
        // If we only have contributor children, return manual fulfillment
        if (!this.hasNonContributionChild) {
          return this._manualFulfillment;
        }

        // For hybrid case: combine manual fulfillment for contributor children
        // with calculated fulfillment for non-contributor children
        const contributionChildrenWeight =
          this.contributionChildrenWeight;
        const nonContributionFulfillment =
          this.nonContributionChildrenFulfillment;

        return (
          this._manualFulfillment * contributionChildrenWeight +
          nonContributionFulfillment * (1 - contributionChildrenWeight)
        );
      }

      // Default case: calculate from all children
      return Array.from(this.children.values()).reduce(
        (sum, child) => sum + child.fulfilled * child.shareOfParent,
        0
      );
    }

    get desire(): number {
      return 1 - this.fulfilled;
    }

    get manualFulfillment(): number | null {
      return this._manualFulfillment;
    }
    
    set manualFulfillment(value: number | null) {
      console.log(`[TreeNode] Setting manual fulfillment for ${this.name} to ${value}`);
      this._manualFulfillment = value;
      
      // Update in Gun using direct approach
      this.gunRef.get('manualFulfillment').put(value);
      
      this.app.pieUpdateNeeded = true;
    }

    get fulfillmentWeight(): number {
      return this.fulfilled * this.weight;
    }

    // Helper method to get all instances of a given type
    getInstances(type: TreeNode): Set<TreeNode> {
      return this.root.typeIndex.get(type) || new Set();
    }

    shareOfGeneralFulfillment(node: TreeNode): number {
      const instances = this.getInstances(node);
      return Array.from(instances).reduce((sum, instance) => {
        const contributorTypesCount = Array.from(instance._typesMap.values()).filter(type => type.isContributor).length;

        const fulfillmentWeight = instance.fulfilled * instance.weight;

        const weightShare =
          contributorTypesCount > 0
            ? fulfillmentWeight / contributorTypesCount
            : fulfillmentWeight;

        return sum + weightShare;
      }, 0);
    }

    mutualFulfillment(node: TreeNode): number {
      const recognitionFromHere = this.shareOfGeneralFulfillment(node);
      const recognitionFromThere = node.shareOfGeneralFulfillment(this);
      return Math.min(recognitionFromHere, recognitionFromThere);
    }

    get mutualFulfillmentDistribution(): Map<TreeNode, number> {
      const types = Array.from(this.root.typeIndex.keys()).filter(
        type => this.getInstances(type).size > 0
      );

      const rawDistribution = types
        .map(type => ({
          type,
          value: this.mutualFulfillment(type),
        }))
        .filter(entry => entry.value > 0);

      const total = rawDistribution.reduce((sum, entry) => sum + entry.value, 0);

      return new Map(
        rawDistribution.map(entry => [
          entry.type,
          total > 0 ? entry.value / total : 0,
        ])
      );
    }
    
        // D3 Compatibility Methods
      get value() {
          return this.points;
      }
  
      get childrenArray() {
          const result = Array.from(this.children.values());
          return result;
      }
  
      get data() {
          return this;
      }
  
      get hasChildren() {
          return this.children.size > 0;
      }
      
      get descendants() {
          const result: TreeNode[] = [];
          const stack: TreeNode[] = [this];
          while (stack.length) {
              const node = stack.pop();
              if (!node) continue;
              result.push(node);
              stack.push(...node.childrenArray);
          }
          return result;
      }
  
      get ancestors() {
          const result: TreeNode[] = [];
          let current: TreeNode = this;
          while (current) {
              result.push(current);
              if (!current.parent) break;
              current = current.parent;
          }
          return result;
      }

  // GUN Methods

    // Save this node to Gun
    saveToGun() {
      console.log(`[TreeNode] Saving node ${this.name} (ID: ${this.id}) to Gun`);
      
      const data = {
        name: this._name,
        points: this._points,
        manualFulfillment: this._manualFulfillment,
      };
      
      console.log(`[TreeNode] Node data being saved:`, data);
      
      // Use Gun's direct put operation
      this.gunRef.put(data);
      
      console.log(`[TreeNode] Saved node data:`, data);
      
      // Save parent reference if it exists
      if (this._parent) {
        console.log(`[TreeNode] Saving parent reference: ${this._parent.id}`);
        
        // Get reference to parent node and link directly
        const parentRef = gun.get('nodes').get(this._parent.id);
        this.gunRef.get('parent').put(parentRef);
      }
      
      // Save children references using Gun's set operation
      if (this.children.size > 0) {
        console.log(`[TreeNode] Saving ${this.children.size} children references`);
        
        Array.from(this.children.values()).forEach(child => {
          console.log(`[TreeNode] Saving child reference: ${child.id}`);
          
          // Get reference to child node and add to children collection
          const childRef = gun.get('nodes').get(child.id);
          this.gunRef.get('children').set(childRef);
        });
      }
      
      // Save type references using Gun's put operation directly with ID keys
      if (this._typesMap.size > 0) {
        console.log(`[TreeNode] Saving ${this._typesMap.size} type references`);
        
        Array.from(this._typesMap.entries()).forEach(([typeId, type]) => {
          console.log(`[TreeNode] Saving type reference: ${typeId}`);
          
          // Get reference to type node and add to types collection with its ID as key
          const typeRef = gun.get('nodes').get(typeId);
          this.gunRef.get('types').get(typeId).put(typeRef);
        });
      }
      
      console.log(`[TreeNode] Save to Gun complete for node ${this.id}`);
    }
    
    // Set up Gun subscriptions
    setupSubscriptions() {
      console.log(`[TreeNode] Setting up subscriptions for node ${this.id}`);
      
      // Subscribe to node data changes
      this.nodeSubscription = readFromGunPath(['nodes', this.id], true);
      if (this.nodeSubscription.gunNodeRef) {
        this.nodeSubscription.gunNodeRef.on((data) => {
          if (data) {
            console.log(`[TreeNode] Received data update for node ${this.id}:`, data);
            
            // Handle name updates properly - only update if name is defined
            if (data.name !== undefined && this._name === '') {
              console.log(`[TreeNode] Updating name from "${this._name}" to "${data.name}"`);
              this._name = data.name;
            }
            
            if (typeof data.points === 'number') {
              this._points = data.points;
            }
            
            if (data.manualFulfillment !== undefined) {
              this._manualFulfillment = data.manualFulfillment;
            }
          }
        });
      }
      
      // Subscribe to children changes
      console.log(`[TreeNode] Setting up children subscription for ${this.id}`);
      this.childrenSubscription = readFromGunPath(['nodes', this.id, 'children'], true);
      if (this.childrenSubscription.gunNodeRef) {
        this.childrenSubscription.gunNodeRef.map().on((data, key) => {
          if (key === '_') return;
          
          // When handling references in Gun, we need to extract the soul (ID)
          // from the reference's metadata
          const childId = data && data._?.['#'] || key;
          
          console.log(`[TreeNode] Detected child with key ${key} and ID ${childId} for node ${this.id}`);
          
          // Skip if we already have this child
          if (this.children.has(childId)) {
            console.log(`[TreeNode] Child ${childId} already loaded, skipping`);
            return;
          }
          
          // New child detected, load it
          console.log(`[TreeNode] Loading new child with ID ${childId}`);
          TreeNode.fromId(childId).then(child => {
            if (child) {
              console.log(`[TreeNode] Child ${childId} (${child.name}) loaded successfully for ${this.id}`);
              child._parent = this;
              this.children.set(childId, child);
            } else {
              console.warn(`[TreeNode] Failed to load child with ID ${childId}`);
            }
          });
        });
      }
      
      // Subscribe to types changes
      console.log(`[TreeNode] Setting up types subscription for ${this.id}`);
      this.typesSubscription = readFromGunPath(['nodes', this.id, 'types'], true);
      if (this.typesSubscription.gunNodeRef) {
        this.typesSubscription.gunNodeRef.map().on((data, key) => {
          if (key === '_') return;
          
          // Extract the typeId - might be in the reference or as the key
          let typeId = key;
          if (data && data._ && data._['#']) {
            typeId = data._['#'];
          }
          
          console.log(`[TreeNode] Detected type with key ${key} and ID ${typeId} for node ${this.id}`);
          
          // Check if we already have this type
          if (this._typesMap.has(typeId)) {
            console.log(`[TreeNode] Type ${typeId} already loaded, skipping`);
            return;
          }
          
          // New type detected, load it
          console.log(`[TreeNode] Loading new type with ID ${typeId}`);
          TreeNode.fromId(typeId).then(type => {
            if (type) {
              console.log(`[TreeNode] Type ${typeId} (${type.name}) loaded successfully for ${this.id}`);
              this._typesMap.set(typeId, type);
              
              // Update type index
              const root = this.root;
              if (!root.typeIndex.has(type)) {
                root.typeIndex.set(type, new Set());
              }
              root.typeIndex.get(type)?.add(this);
              
              // Update UI to reflect changes
              this.app.updateNeeded = true;
              this.app.pieUpdateNeeded = true;
            } else {
              console.warn(`[TreeNode] Failed to load type with ID ${typeId}`);
            }
          }).catch(err => {
            console.error(`[TreeNode] Error loading type ${typeId}:`, err);
          });
        });
      }
      
      console.log(`[TreeNode] All subscriptions set up for node ${this.id}`);
    }
    
    // Clean up subscriptions
    unsubscribe() {
      if (this.nodeSubscription && this.nodeSubscription.gunNodeRef) {
        this.nodeSubscription.gunNodeRef.off();
      }
      if (this.childrenSubscription && this.childrenSubscription.gunNodeRef) {
        this.childrenSubscription.gunNodeRef.off();
      }
      if (this.typesSubscription && this.typesSubscription.gunNodeRef) {
        this.typesSubscription.gunNodeRef.off();
      }
    }
    
    // Static method to create a TreeNode from Gun ID
    static async fromId(id: string): Promise<TreeNode | null> {
      return Promise.race([
        new Promise<TreeNode | null>((resolve) => {
          console.log(`[TreeNode] Attempting to load node with ID: ${id}`);
          
          // First try to load from the users path
          const userRef = readFromGunPath(['users', id]);
          userRef.gunNodeRef.once((userData, userKey) => {
            if (userData && Object.keys(userData).some(k => k !== '_')) {
              console.log(`[TreeNode.fromId] Found node in users path: ${id}`);
              
              // Create the node
              const node = new TreeNode(
                userData.name || 'Unnamed',
                id,
                null,
                []
              );
              
              // Set initial properties
              if (typeof userData.points === 'number') {
                node._points = userData.points;
              }
              if (userData.manualFulfillment !== undefined) {
                node._manualFulfillment = userData.manualFulfillment;
              }
              
              resolve(node);
              return;
            }
            
            // If not found in users, try in nodes
            console.log(`[TreeNode.fromId] Node not found in users path, trying nodes: ${id}`);
            const nodeRef = readFromGunPath(['nodes', id]);
            nodeRef.gunNodeRef.once((data, key) => {
              if (!data) {
                console.log(`[TreeNode] Node ${id} not found in Gun (data is falsy)`);
                resolve(null);
                return;
              }
              
              // Verify it has actual properties beyond Gun metadata
              const hasValidData = Object.keys(data).some(k => k !== '_');
              if (!hasValidData) {
                console.log(`[TreeNode] Node ${id} exists but has no data properties`);
                resolve(null);
                return;
              }
              
              console.log(`[TreeNode.fromId] Raw data from Gun for node ${id}:`, data);
              
              // Clean up data handling - check for name explicitly 
              const name = data.name;
              console.log(`[TreeNode.fromId] Node name from Gun: "${name}" (${typeof name})`);
              
              if (name === undefined) {
                console.warn(`[TreeNode.fromId] Name is undefined for node ${id}, will use 'Unnamed'`);
              }
              
              const node = new TreeNode(
                name || 'Unnamed',
                id,
                null, // Parent will be set by caller
                [] // Types will be loaded via subscription
              );
              
              console.log(`[TreeNode.fromId] Created node with name: "${node.name}" (ID: ${node.id})`);
              
              // Set initial properties
              if (typeof data.points === 'number') {
                node._points = data.points;
              }
              if (data.manualFulfillment !== undefined) {
                node._manualFulfillment = data.manualFulfillment;
              }
              
              // Load types immediately to populate typeIndex
              const typesRef = readFromGunPath(['nodes', id, 'types']);
              typesRef.gunNodeRef.once((typesData) => {
                if (typesData && typeof typesData === 'object') {
                  // Filter out Gun metadata
                  const typeIds = Object.keys(typesData).filter(k => k !== '_');
                  
                  if (typeIds.length > 0) {
                    console.log(`[TreeNode] Node ${id} has types: ${typeIds.join(', ')}`);
                    
                    // Handle each type key separately to get the referenced ID
                    Promise.all(typeIds.map(typeKey => {
                      return new Promise<string | null>((resolve) => {
                        typesRef.gunNodeRef.get(typeKey).once((typeRefData) => {
                          let typeId = typeKey;
                          if (typeRefData && typeRefData._ && typeRefData._['#']) {
                            typeId = typeRefData._['#'];
                          }
                          resolve(typeId);
                        });
                      });
                    }))
                    .then(extractedTypeIds => {
                      // Filter out nulls and duplicates
                      const validTypeIds = [...new Set(extractedTypeIds.filter(id => id !== null) as string[])];
                      
                      // Load each type node
                      return Promise.all(validTypeIds.map(typeId => TreeNode.fromId(typeId)));
                    })
                    .then(loadedTypes => {
                      // Filter out nulls
                      const validTypes = loadedTypes.filter(t => t !== null) as TreeNode[];
                      
                      // For each valid type, add this node as an instance
                      validTypes.forEach(type => {
                        if (type) {
                          console.log(`[TreeNode] Adding type ${type.id} (${type.name}) to node ${node.name}`);
                          // Store in _typesMap by ID to prevent duplicates
                          node._typesMap.set(type.id, type);
                          
                          // Update typeIndex at root level
                          const root = node.root;
                          if (!root.typeIndex.has(type)) {
                            root.typeIndex.set(type, new Set());
                          }
                          root.typeIndex.get(type)?.add(node);
                        }
                      });
                      
                      // Update UI 
                      node.app.updateNeeded = true;
                      node.app.pieUpdateNeeded = true;
                    })
                    .catch(err => {
                      console.error(`[TreeNode] Error loading types for node ${id}:`, err);
                    });
                  }
                }
              });
              
              resolve(node);
            });
          });
        }),
        // Add a timeout to prevent hanging
        new Promise<null>(resolve => setTimeout(() => {
          console.log(`[TreeNode] Timeout loading node ${id}, assuming it doesn't exist`);
          resolve(null);
        }, 3000))
      ]);
    }
}
  