import { gun } from './Gun';
import { GunSubscription, type SubscriptionCleanup, type SubscriptionHandler } from './GunSubscription';

/**
 * Base class for Gun node wrappers that provides a consistent API
 * Following the guide's recommendations for wrapping Gun functionality
 */
export class GunNode<T = any> {
  protected chain: any;
  protected path: string[];
  
  /**
   * Create a new Gun node wrapper
   * @param path Array of path segments to the node
   */
  constructor(path: string[]) {
    this.path = [...path]; // Store a copy of the path
    
    // Navigate the Gun path to create the chain
    let ref = gun as any;
    for (const segment of path) {
      ref = ref.get(segment);
    }
    this.chain = ref;
  }

  /**
   * Get a child node at the given path
   * @param key The key of the child node
   * @param NodeClass The class to use for the child node (defaults to GunNode)
   * @returns A new instance of the provided NodeClass
   */
  public get<R = any, N extends GunNode<R> = GunNode<R>>(
    key: string,
    NodeClass: new (path: string[]) => N = GunNode as any
  ): N {
    // Create a new path with the child key
    const childPath = [...this.path, key];
    return new NodeClass(childPath);
  }

  /**
   * Put a value to the Gun node
   * @param value The value to put
   * @param options Optional Gun options (e.g., for certificates)
   * @returns This node instance for chaining
   */
  public put(value: Partial<T>, options?: any): this {
    // Create a clone of options to avoid mutation
    const opts = options ? structuredClone(options) : null;
    this.chain.put(value, null, opts);
    return this;
  }

  /**
   * Subscribe to updates from this node
   * @param handler Function to call with updates
   * @returns A function to unsubscribe
   */
  public on(handler: SubscriptionHandler<T>): SubscriptionCleanup {
    const subscription = new GunSubscription<T>(this.path);
    return subscription.on(handler);
  }

  /**
   * Get a single value from the node and resolve
   * @returns Promise that resolves with the node value
   */
  public once(): Promise<T> {
    const subscription = new GunSubscription<T>(this.path);
    return subscription.once();
  }

  /**
   * Get a readable stream of values from this node
   * @returns A subscription that can be used as a stream
   */
  public stream(): GunSubscription<T> {
    return new GunSubscription<T>(this.path);
  }

  /**
   * Subscribe to all values in this node (for collections)
   * @param handler Function to call with each item
   * @returns A function to unsubscribe
   */
  public each(handler: SubscriptionHandler<any>): SubscriptionCleanup {
    const subscription = new GunSubscription(this.path);
    const eachSub = subscription.each();
    return eachSub.on(handler);
  }

  /**
   * Create a Svelte-compatible store from this node's data
   * @param initialValue Optional initial value to use before data arrives
   * @returns A store with subscribe method that emits updates
   */
  public toStore(initialValue?: T) {
    const subscription = new GunSubscription<T>(this.path);
    return subscription.toStore();
  }
  
  /**
   * Get an object representation of this node
   * @param initialValue Optional initial value to use before data arrives
   * @returns A subscription that emits the full object
   */
  public asObject(initialValue: Record<string, any> = {}): GunSubscription<Record<string, any>> {
    const subscription = new GunSubscription(this.path);
    return subscription.asObject(initialValue);
  }

  /**
   * Get the full path to this node as an array
   * @returns Array of path segments
   */
  protected getPath(): string[] {
    return [...this.path]; // Return a copy
  }

  /**
   * Get the Soul (unique identifier) of this node if it has one
   * @returns Promise that resolves with the Soul string or undefined
   */
  public async getSoul(): Promise<string | undefined> {
    try {
      const data = await this.once();
      if (data && data['_'] && data['_']['#']) {
        return data['_']['#'];
      }
      return undefined;
    } catch (err) {
      console.error('Error getting Soul:', err);
      return undefined;
    }
  }

  /**
   * Check if this node exists in the database
   * @returns Promise that resolves to true if the node exists with data
   */
  public async exists(): Promise<boolean> {
    try {
      const data = await this.once();
      return Boolean(data && Object.keys(data).filter(k => k !== '_').length > 0);
    } catch (err) {
      return false;
    }
  }
  
  /**
   * Return the Gun chain directly if needed
   * Warning: Using this bypasses the abstraction
   * @returns The raw Gun chain
   */
  public getChain(): any {
    return this.chain;
  }
} 