import { GunSubscription } from "./GunSubscription";
import { ReactiveEntity } from "./Reactive";
import { TreeNode } from "./ReactTreeNode";

/**
 * Helper functions that demonstrate using the streaming API
 * for common TreeNode calculations
 */
export class TreeNodeStreamHelper {
  /**
   * Calculate share of general fulfillment using streams
   * @param node The TreeNode to calculate for
   * @returns GunSubscription that emits the share value whenever it changes
   */
  static calculateShareOfGeneralFulfillment(node: TreeNode): GunSubscription<number> {
    // Get a subscription to parent property
    const parentStream = node.getPropertyStream('parent');
    
    // Map the parent to a share value
    return parentStream.map(parentId => {
      if (!parentId) return 0;
      
      // Get the parent node
      const parent = node.parent;
      if (!parent) return 0;
      
      // If node isn't a contributor, return 0
      if (!node.isContributor) return 0;
      
      // Get this node's share of parent - directly using computed property
      return node.shareOfParent;
    });
  }
  
  /**
   * Calculate the shares distribution for all children of a node
   * @param node The parent TreeNode
   * @returns GunSubscription that emits a map of nodeId -> share whenever any values change
   */
  static calculateChildrenShares(node: TreeNode): GunSubscription<Map<string, number>> {
    // Access the children property which is a Map<string, TreeNode>
    const childrenStream = node.getComputedStream<Map<string, TreeNode>>('_children');
    
    // Transform into a map of child ID -> share
    return {
      on: (handler: (value: Map<string, number>) => void) => {
        // Set up subscription
        const cleanup = childrenStream.on(children => {
          // Create a map to hold the shares
          const shares = new Map<string, number>();
          
          // Skip if no children
          if (!children || children.size === 0) {
            handler(shares);
            return;
          }
          
          // Calculate total points for contributors
          let totalPoints = 0;
          for (const [_, child] of children) {
            if (child.isContributor) {
              totalPoints += child.points;
            }
          }
          
          // Calculate share for each child
          if (totalPoints > 0) {
            for (const [childId, child] of children) {
              if (child.isContributor) {
                const share = child.points / totalPoints;
                shares.set(childId, share);
              } else {
                shares.set(childId, 0); // Non-contributors get 0 share
              }
            }
          }
          
          handler(shares);
        });
        
        return cleanup;
      }
    } as GunSubscription<Map<string, number>>;
  }
  
  /**
   * Create a stream that calculates the combined fulfillment of a node
   * based on direct fulfillment and fulfillment from children
   * @param node The TreeNode to calculate for
   * @returns GunSubscription that emits the combined fulfillment value
   */
  static combinedFulfillmentStream(node: TreeNode): GunSubscription<number> {
    // Create a subscription to 'fulfilled' computed property
    const fulfilledStream = node.getComputedStream<number>('fulfilled');
    
    // Create subscription to 'contributionChildrenFulfillment' computed property
    const childrenFulfillmentStream = node.getComputedStream<number>('contributionChildrenFulfillment');
    
    // Return a combined subscription
    return {
      on: (handler: (value: number) => void) => {
        let currentFulfilled = 0;
        let currentChildrenFulfillment = 0;
        
        // Track if both streams have emitted at least once
        let fulfilledEmitted = false;
        let childrenEmitted = false;
        
        // Function to calculate and emit combined value
        const calculateCombined = () => {
          if (fulfilledEmitted && childrenEmitted) {
            // Combine values (taking max as in the original implementation)
            const combined = Math.max(currentFulfilled, currentChildrenFulfillment);
            handler(combined);
          }
        };
        
        // Subscribe to fulfilled
        const cleanup1 = fulfilledStream.on(value => {
          currentFulfilled = value;
          fulfilledEmitted = true;
          calculateCombined();
        });
        
        // Subscribe to children fulfillment
        const cleanup2 = childrenFulfillmentStream.on(value => {
          currentChildrenFulfillment = value;
          childrenEmitted = true;
          calculateCombined();
        });
        
        // Combined cleanup function
        return () => {
          cleanup1();
          cleanup2();
        };
      }
    } as GunSubscription<number>;
  }
  
  /**
   * Example of using streams to watch a node's mutual fulfillment distribution
   * @param node The node to watch
   * @param onUpdate Callback function that receives updates
   * @returns A cleanup function to stop watching
   */
  static watchMutualFulfillmentDistribution(node: TreeNode, onUpdate: (distribution: Map<string, number>) => void): () => void {
    // Create a custom stream for mutual fulfillment distribution
    const distribution = {
      on: (handler: (value: Map<string, number>) => void) => {
        // We need to watch for changes in types and their fulfillment
        let typesCleanup: (() => void) | null = null;
        
        // Function to set up type-specific watchers
        const setupTypeWatchers = () => {
          // Get current distribution
          const distribution = node.mutualFulfillmentDistribution;
          
          // Emit current value
          handler(distribution);
        };
        
        // Watch for changes in types
        const typesStream = node.getComputedStream<Set<string>>('_types');
        typesCleanup = typesStream.on(() => {
          setupTypeWatchers();
        });
        
        // Initial setup
        setupTypeWatchers();
        
        // Return combined cleanup
        return () => {
          if (typesCleanup) typesCleanup();
        };
      }
    } as GunSubscription<Map<string, number>>;
    
    // Subscribe to updates
    return distribution.on(onUpdate);
  }
  
  /**
   * Example of a more efficient implementation of calculateShares using streams
   * @param node The TreeNode to calculate for (should be a root node)
   * @returns Stream of share calculations
   */
  static calculateSharesStream(node: TreeNode): GunSubscription<{[key: string]: number}> {
    // Check if node is root
    if (node.parent) {
      console.warn('calculateSharesStream should be called on a root node');
    }
    
    // Create a custom stream that calculates shares
    return {
      on: (handler: (shares: {[key: string]: number}) => void) => {
        // Track subscriptions to clean up
        const cleanups: (() => void)[] = [];
        
        // Function to recalculate shares
        const recalculateShares = () => {
          // Use node's existing calculateShares method
          const shares = node.shares;
          handler(shares);
        };
        
        // Watch for changes in type index (affects shares calculation)
        const typeIndexStream = node.getComputedStream<Map<string, Set<string>>>('_typeIndex');
        cleanups.push(typeIndexStream.on(() => {
          recalculateShares();
        }));
        
        // Watch for changes in node fulfillment values
        // This is a simplification, as we should set up dynamic watching of all nodes
        const fulfilledStream = node.getComputedStream<number>('fulfilled');
        cleanups.push(fulfilledStream.on(() => {
          recalculateShares();
        }));
        
        // Initial calculation
        recalculateShares();
        
        // Combined cleanup function
        return () => {
          cleanups.forEach(cleanup => cleanup());
        };
      }
    } as GunSubscription<{[key: string]: number}>;
  }
} 