import { gun } from './Gun';
import { GunSubscription, type SubscriptionCleanup, type SubscriptionHandler } from './GunSubscription';
import { GunNode } from './GunNode';
import { App } from '../App';

/**
 * Core reactive primitive that can be observed for changes
 */
export class Reactive<T> {
    protected _value: T;
    protected _observers = new Set<(value: T) => void>();
    protected _dependents = new Set<Computed<any>>();
    protected _disposed = false;
    protected _errorHandlers = new Set<(error: any) => void>();
  
    constructor(initialValue: T) {
      this._value = initialValue;
    }
  
    get value(): T {
      if (this._disposed) {
        console.warn('Accessing value of disposed Reactive');
      }
      
      // Track this access if we're inside a computation
      Computed.trackAccess(this);
      return this._value;
    }
  
    set value(newValue: T) {
      if (this._disposed) {
        console.warn('Setting value of disposed Reactive');
        return;
      }
      
      try {
      if (this._value !== newValue) {
        this._value = newValue;
        this.notify();
        }
      } catch (err) {
        console.error('Error setting reactive value:', err);
        this._errorHandlers.forEach(handler => {
          try {
            handler(err);
          } catch (handlerErr) {
            console.error('Error in error handler:', handlerErr);
          }
        });
      }
    }
  
    /**
     * Update the value using a function
     */
    update(updater: (current: T) => T): void {
      if (this._disposed) {
        console.warn('Updating value of disposed Reactive');
        return;
      }
      
      try {
        const newValue = updater(this._value);
        this.value = newValue;
      } catch (err) {
        console.error('Error in update function:', err);
        this._errorHandlers.forEach(handler => {
          try {
            handler(err);
          } catch (handlerErr) {
            console.error('Error in error handler:', handlerErr);
          }
        });
      }
    }
  
    /**
     * Add an error handler
     */
    onError(handler: (error: any) => void): () => void {
      this._errorHandlers.add(handler);
      return () => this._errorHandlers.delete(handler);
    }
  
    /**
     * Add a dependency to this reactive value
     */
    addDependent(dependent: Computed<any>): void {
      if (this._disposed) return;
      this._dependents.add(dependent);
    }
  
    /**
     * Remove a dependency from this reactive value
     */
    removeDependent(dependent: Computed<any>): void {
      this._dependents.delete(dependent);
    }
  
    /**
     * Subscribe to changes in the value
     */
    subscribe(observer: (value: T) => void): () => void {
      if (this._disposed) {
        console.warn('Subscribing to disposed Reactive');
        // Return a no-op unsubscribe function
        return () => {};
      }
      
      this._observers.add(observer);
      
      // Call immediately with current value
      try {
      observer(this._value);
      } catch (err) {
        console.error('Error in observer during initial call:', err);
      }
      
      return () => {
        this._observers.delete(observer);
      };
    }
  
    /**
     * Notify all observers and dependents about changes
     */
    private notify(): void {
      if (this._disposed) return;
      
      // Schedule notification via Batch to avoid cascading updates
      Batch.schedule(() => {
        if (this._disposed) return;
        
      // Notify direct observers
        this._observers.forEach(observer => {
          try {
            observer(this._value);
          } catch (err) {
            console.error('Error notifying observer:', err);
          }
        });
      
      // Invalidate dependent computations
        this._dependents.forEach(dependent => {
          try {
            dependent.invalidate();
          } catch (err) {
            console.error('Error invalidating dependent:', err);
          }
        });
      });
    }
  
    /**
     * Create a Svelte-compatible store
     */
    toStore() {
      return {
        subscribe: (run: SubscriptionHandler<T>) => {
          return this.subscribe(run);
        }
      };
    }
    
    /**
     * Check if this reactive has been disposed
     */
    get isDisposed(): boolean {
      return this._disposed;
    }
  
    /**
     * Dispose of all resources
     */
    dispose(): void {
      if (this._disposed) return;
      
      this._disposed = true;
      this._observers.clear();
      
      // Remove this as a dependency from all dependents
      this._dependents.forEach(dependent => {
        dependent.removeDependency(this);
      });
      
      this._dependents.clear();
      this._errorHandlers.clear();
    }
  }
  
  /**
   * Computed value that depends on reactive values
   */
  export class Computed<T> {
    private _value: T | null = null;
    private _computer: () => T;
    private _observers = new Set<(value: T) => void>();
    private _dependencies = new Set<Reactive<any> | Computed<any>>();
    private _dependents = new Set<Computed<any>>();
    private _valid = false;
    private _disposed = false;
    private _computing = false; // To detect circular dependencies
    private _errorHandlers = new Set<(error: any) => void>();
    private _lastComputeError: any = null;
  
    // Static tracking for automatic dependency detection
    public static currentComputation: Computed<any> | null = null;
  
    constructor(computer: () => T) {
      this._computer = computer;
    }
  
    /**
     * Track access to a reactive value during computation
     */
    static trackAccess(dependency: Reactive<any> | Computed<any>): void {
      if (Computed.currentComputation) {
        Computed.currentComputation.addDependency(dependency);
      }
    }
  
    /**
     * Add a dependency to this computation
     */
    addDependency(dependency: Reactive<any> | Computed<any>): void {
      if (this._disposed) return;
      if (this._dependencies.has(dependency)) return;
      
      // Check for circular dependencies
      if (dependency instanceof Computed && 
          (dependency === this || this.isDependentOn(dependency))) {
        console.error('Circular dependency detected in computation');
        return;
      }
      
      this._dependencies.add(dependency);
      
      // Register this computation as a dependent of the dependency
      if (dependency instanceof Reactive) {
        dependency.addDependent(this);
      } else if (dependency instanceof Computed) {
        dependency.addDependent(this);
      }
    }
    
    /**
     * Check if this computation depends on another computation
     * directly or indirectly (to detect circular dependencies)
     */
    private isDependentOn(target: Computed<any>): boolean {
      // Check direct dependencies
      if (target._dependents.has(this)) return true;
      
      // Check indirect dependencies
      for (const dep of target._dependents) {
        if (dep instanceof Computed && dep.isDependentOn(this)) {
          return true;
        }
      }
      
      return false;
    }
  
    /**
     * Remove a dependency from this computation
     */
    removeDependency(dependency: Reactive<any> | Computed<any>): void {
      if (!this._dependencies.has(dependency)) return;
      
      this._dependencies.delete(dependency);
      
      // Unregister this computation as a dependent
      if (dependency instanceof Reactive) {
        dependency.removeDependent(this);
      } else if (dependency instanceof Computed) {
        dependency.removeDependent(this);
      }
    }
  
    /**
     * Add a dependent computation
     */
    addDependent(dependent: Computed<any>): void {
      if (this._disposed) return;
      
      // Check for circular dependencies
      if (dependent === this || this.isDependentOn(dependent)) {
        console.error('Circular dependency detected when adding dependent');
        return;
      }
      
      this._dependents.add(dependent);
    }
  
    /**
     * Remove a dependent computation
     */
    removeDependent(dependent: Computed<any>): void {
      this._dependents.delete(dependent);
    }
    
    /**
     * Add an error handler
     */
    onError(handler: (error: any) => void): () => void {
      this._errorHandlers.add(handler);
      
      // Call immediately if we have an error
      if (this._lastComputeError) {
        try {
          handler(this._lastComputeError);
        } catch (err) {
          console.error('Error in error handler during initial call:', err);
        }
      }
      
      return () => this._errorHandlers.delete(handler);
    }
  
    /**
     * Get the computed value
     */
    get value(): T {
      if (this._disposed) {
        console.warn('Accessing value of disposed Computed');
        if (this._lastComputeError) throw this._lastComputeError;
        throw new Error('Cannot access value of disposed Computed');
      }
      
      // Track this access if we're inside another computation
      Computed.trackAccess(this);
      
      // Detect circular computations
      if (this._computing) {
        console.error('Circular computation detected');
        throw new Error('Circular computation detected');
      }
      
      // Recompute if invalid
      if (!this._valid) {
        this.recompute();
      }
      
      // Throw last error if computation failed
      if (this._lastComputeError) {
        throw this._lastComputeError;
      }
      
      return this._value!;
    }
  
    /**
     * Invalidate the computed value
     */
    invalidate(): void {
      if (!this._valid || this._disposed) return;
      
      this._valid = false;
      
      // Invalidate dependents
      this._dependents.forEach(dependent => {
        try {
          dependent.invalidate();
        } catch (err) {
          console.error('Error invalidating dependent:', err);
        }
      });
      
      // Notify observers if we have any
      if (this._observers.size > 0) {
        // Use batch for notification to avoid cascading updates
        Batch.schedule(() => {
          if (this._disposed) return;
          
        this.recompute();
        this.notify();
        });
      }
    }
  
    /**
     * Recompute the value
     */
    private recompute(): void {
      if (this._disposed) return;
      if (this._computing) {
        console.error('Attempted to recompute during computation (circular dependency)');
        return;
      }
      
      // Clear last error
      this._lastComputeError = null;
      
      // Clear existing dependencies
      const oldDependencies = new Set(this._dependencies);
      this._dependencies.clear();
      
      // Set this as the current computation
      const previousComputation = Computed.currentComputation;
      Computed.currentComputation = this;
      this._computing = true;
      
      try {
        // Compute the new value
        this._value = this._computer();
        this._valid = true;
      } catch (err) {
        console.error('Error in computation:', err);
        this._lastComputeError = err;
        this._errorHandlers.forEach(handler => {
          try {
            handler(err);
          } catch (handlerErr) {
            console.error('Error in error handler:', handlerErr);
          }
        });
      } finally {
        // Restore the previous computation
        this._computing = false;
        Computed.currentComputation = previousComputation;
        
        // Remove this as a dependent from any dependencies that are no longer used
        oldDependencies.forEach(dependency => {
          if (!this._dependencies.has(dependency)) {
            if (dependency instanceof Reactive) {
              dependency.removeDependent(this);
            } else if (dependency instanceof Computed) {
              dependency.removeDependent(this);
            }
          }
        });
      }
    }
  
    /**
     * Subscribe to changes in the computed value
     */
    subscribe(observer: (value: T) => void): () => void {
      if (this._disposed) {
        console.warn('Subscribing to disposed Computed');
        // Return a no-op unsubscribe function
        return () => {};
      }
      
      // Ensure we have a valid value
      if (!this._valid) {
        this.recompute();
      }
      
      this._observers.add(observer);
      
      // Call immediately with current value if we have one and no error
      if (this._value !== null && !this._lastComputeError) {
        try {
          observer(this._value);
        } catch (err) {
          console.error('Error in observer during initial call:', err);
        }
      }
      
      return () => {
        this._observers.delete(observer);
      };
    }
  
    /**
     * Notify all observers about changes
     */
    private notify(): void {
      if (this._disposed || this._lastComputeError) return;
      
      this._observers.forEach(observer => {
        try {
          observer(this._value!);
        } catch (err) {
          console.error('Error notifying observer:', err);
        }
      });
    }
  
    /**
     * Create a Svelte-compatible store
     */
    toStore() {
      return {
        subscribe: (run: SubscriptionHandler<T>) => {
          return this.subscribe(run);
        }
      };
    }
    
    /**
     * Check if this computed has been disposed
     */
    get isDisposed(): boolean {
      return this._disposed;
    }
    
    /**
     * Force a recomputation of the value
     */
    refresh(): T {
      this.invalidate();
      return this.value;
    }
  
    /**
     * Dispose of all resources
     */
    dispose(): void {
      if (this._disposed) return;
      
      this._disposed = true;
      this._valid = false;
      this._value = null;
      this._observers.clear();
      this._errorHandlers.clear();
      
      // Remove this as a dependent from all dependencies
      this._dependencies.forEach(dependency => {
        if (dependency instanceof Reactive) {
          dependency.removeDependent(this);
        } else if (dependency instanceof Computed) {
          dependency.removeDependent(this);
        }
      });
      
      this._dependencies.clear();
      
      // Notify dependents that we're disposed
      this._dependents.forEach(dependent => {
        dependent.removeDependency(this);
      });
      
      this._dependents.clear();
    }
  }
  
  /**
   * Batch processor for scheduling related updates
   * Enhanced to better handle Gun's behavior
   */
  export class Batch {
    private static _queue = new Set<() => void>();
    private static _scheduled = false;
    private static _timeoutId: any = null;
    private static _startupMode = true;
    private static _startupEndsAt = 0;
    private static _gunUpdates = new Map<string, { path: string[], data: any, timestamp: number }>();
    private static _gunUpdatesCooldown = 1000;
    private static _gunUpdatesDebounceId: any = null;

    /**
     * Initialize batch processor with startup mode
     * Call this when your application starts
     */
    static init(startupDuration: number = 3000): void {
      Batch._startupMode = true;
      Batch._startupEndsAt = Date.now() + startupDuration;
      
      // Schedule the end of startup mode
      setTimeout(() => {
        Batch._startupMode = false;
        // Process any pending Gun updates when startup ends
        Batch.processGunUpdates();
      }, startupDuration);
    }

    /**
     * Check if we're in startup mode
     */
    static get isStartupMode(): boolean {
      // Also check time in case init was called but timer hasn't expired
      if (Batch._startupMode && Date.now() > Batch._startupEndsAt) {
        Batch._startupMode = false;
      }
      return Batch._startupMode;
    }
  
    /**
     * Add a task to the batch
     */
    static schedule(task: () => void): void {
      Batch._queue.add(task);
      
      if (!Batch._scheduled) {
        Batch._scheduled = true;
        
        // Delay longer during startup mode
        const delay = Batch.isStartupMode ? 100 : 16;
        
        // Use requestAnimationFrame when available, fall back to setTimeout
        if (typeof requestAnimationFrame !== 'undefined') {
          Batch._timeoutId = requestAnimationFrame(() => Batch.run());
        } else {
          Batch._timeoutId = setTimeout(() => Batch.run(), delay);
        }
      }
    }

    /**
     * Schedule a Gun update with path and data
     * This will debounce the updates to avoid flooding Gun
     */
    static scheduleGunUpdate(path: string[], data: any): void {
      const pathKey = path.join('/');
      
      // Store or update this path in our update map
      Batch._gunUpdates.set(pathKey, { 
        path, 
        data, 
        timestamp: Date.now() 
      });
      
      // During startup mode, wait until startup ends
      if (Batch.isStartupMode) return;
      
      // Clear existing timer
      if (Batch._gunUpdatesDebounceId) {
        clearTimeout(Batch._gunUpdatesDebounceId);
      }
      
      // Debounce Gun updates with a longer cooldown
      Batch._gunUpdatesDebounceId = setTimeout(() => {
        Batch.processGunUpdates();
      }, Batch._gunUpdatesCooldown);
    }
    
    /**
     * Process all pending Gun updates
     */
    private static processGunUpdates(): void {
      if (Batch._gunUpdates.size === 0) return;
      
      console.log(`Processing ${Batch._gunUpdates.size} Gun updates`);
      
      // Process all updates
      const now = Date.now();
      Batch._gunUpdates.forEach((update, pathKey) => {
        // Only process updates older than cooldown period
        if (now - update.timestamp < Batch._gunUpdatesCooldown) return;
        
        try {
          // Navigate to the path - use gun from import
          let ref = gun as any;
          for (const segment of update.path) {
            ref = ref.get(segment);
          }
          
          // Put the data
          ref.put(update.data);
          
          // Remove from pending updates
          Batch._gunUpdates.delete(pathKey);
        } catch (err) {
          console.error(`Error processing Gun update for ${pathKey}:`, err);
        }
      });
      
      // If we still have updates, schedule another processing
      if (Batch._gunUpdates.size > 0) {
        Batch._gunUpdatesDebounceId = setTimeout(() => {
          Batch.processGunUpdates();
        }, Batch._gunUpdatesCooldown);
      } else {
        Batch._gunUpdatesDebounceId = null;
      }
    }
  
    /**
     * Run all tasks in the batch
     */
    static run(): void {
      Batch._scheduled = false;
      
      if (Batch._timeoutId) {
        if (typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(Batch._timeoutId);
        } else {
        clearTimeout(Batch._timeoutId);
        }
        Batch._timeoutId = null;
      }
      
      // Create a copy to avoid issues if tasks schedule more tasks
      const tasks = Array.from(Batch._queue);
      Batch._queue.clear();
      
      // Run all tasks
      tasks.forEach(task => {
        try {
          task();
        } catch (err) {
          console.error('Error in batch task:', err);
        }
      });
    }
  
    /**
     * Clear all pending tasks
     */
    static clear(): void {
      Batch._queue.clear();
      
      if (Batch._timeoutId) {
        if (typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(Batch._timeoutId);
        } else {
        clearTimeout(Batch._timeoutId);
        }
        Batch._timeoutId = null;
      }
      
      Batch._scheduled = false;
      
      // Also clear Gun updates
      if (Batch._gunUpdatesDebounceId) {
        clearTimeout(Batch._gunUpdatesDebounceId);
        Batch._gunUpdatesDebounceId = null;
      }
      Batch._gunUpdates.clear();
    }
  }
  
  /**
   * Debounced function that automatically schedules via the batch system
   */
  export function debounced<T extends (...args: any[]) => void>(
    fn: T,
    delay: number = 100
  ): (...args: Parameters<T>) => void {
    let timeoutId: any = null;
    let lastArgs: Parameters<T> | null = null;
    
    return (...args: Parameters<T>) => {
      lastArgs = args;
      
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      timeoutId = setTimeout(() => {
        timeoutId = null;
        
        if (lastArgs) {
          Batch.schedule(() => fn(...lastArgs!));
        }
      }, delay);
    };
  }
  
  /**
   * Cache for expensive computations with automatic dependency tracking
   */
  export class ComputationCache<K, V> {
    private _cache = new Map<K, V>();
    private _dependencies = new Map<K, Set<Reactive<any> | Computed<any>>>();
    private _computeFunc: (key: K) => V;
  
    constructor(computeFunc: (key: K) => V) {
      this._computeFunc = computeFunc;
    }
  
    /**
     * Get a value from the cache, computing it if needed
     */
    get(key: K): V {
      // If we're in a computation, track this key as dependent on the current computation
      const currentComputation = Computed.currentComputation;
      if (currentComputation) {
        this.trackDependencies(key, new Set([currentComputation]));
      }
      
      if (!this._cache.has(key)) {
        this._cache.set(key, this._computeFunc(key));
      }
      
      return this._cache.get(key)!;
    }
  
    /**
     * Invalidate a specific key or all entries
     */
    invalidate(key?: K): void {
      if (key !== undefined) {
        this._cache.delete(key);
      } else {
        this._cache.clear();
      }
    }
  
    /**
     * Track dependencies for a key
     */
    trackDependencies(key: K, deps: Set<Reactive<any> | Computed<any>>): void {
      if (!this._dependencies.has(key)) {
        this._dependencies.set(key, new Set());
      }
      
      // Add new dependencies
      deps.forEach(dep => {
        this._dependencies.get(key)!.add(dep);
      });
    }
  
    /**
     * Clear all cache entries
     */
    clear(): void {
      this._cache.clear();
      this._dependencies.clear();
    }
  }
  
  /**
   * Integration with Gun for reactive data
   */
  export class ReactiveGun<T> extends Reactive<T> {
    private _subscription: SubscriptionCleanup | null = null;
    private _gunNode: GunNode<T>;
    private _active: boolean = true;
    private _pendingOperations: Array<() => void> = [];
  
    constructor(path: string[], initialValue: T) {
      super(initialValue);
      this._gunNode = new GunNode<T>(path);
      this.setupSubscription();
    }
  
    private setupSubscription(): void {
      // Unsubscribe if we already have a subscription
      if (this._subscription) {
        this._subscription();
        this._subscription = null;
      }
  
      if (!this._active) return;

      try {
      // Subscribe to changes from Gun and update the reactive value
        // Use GunSubscription instead of direct subscription for better handling
        const subscription = this._gunNode.stream();
        
        this._subscription = subscription.on((data) => {
          try {
            // Only update if we're still active
            if (!this._active) return;
            
        // Update without triggering a write back to Gun
        super.value = data as T;
          } catch (err) {
            console.error('Error in Gun subscription handler:', err);
            this._errorHandlers.forEach(handler => handler(err));
          }
        });
      } catch (err) {
        console.error('Error setting up Gun subscription:', err);
        this._errorHandlers.forEach(handler => handler(err));
      }
    }
  
    /**
     * Add an error handler for Gun operations
     */
    onError(handler: (error: any) => void): () => void {
      this._errorHandlers.add(handler);
      return () => this._errorHandlers.delete(handler);
    }
  
    set value(newValue: T) {
      // Call the parent setter to update local value and notify observers
      super.value = newValue;
      
      // Skip write if we're not active
      if (!this._active) {
        // Queue operation for when we become active again
        this._pendingOperations.push(() => this.value = newValue);
        return;
      }
      
      // Batch writes to Gun using the Batch system
      Batch.schedule(() => {
        try {
      // Write the value to Gun
      this._gunNode.put(newValue);
        } catch (err) {
          console.error('Error writing to Gun:', err);
          this._errorHandlers.forEach(handler => handler(err));
        }
      });
    }
  
    /**
     * Pause reactivity (stop receiving updates)
     */
    pause(): void {
      if (!this._active) return;
      this._active = false;
      
      // Clean up subscription
      if (this._subscription) {
        this._subscription();
        this._subscription = null;
      }
    }
  
    /**
     * Resume reactivity (start receiving updates)
     */
    resume(): void {
      if (this._active) return;
      this._active = true;
      
      // Set up subscription again
      this.setupSubscription();
      
      // Process any pending operations
      const operations = [...this._pendingOperations];
      this._pendingOperations = [];
      operations.forEach(op => op());
    }
  
    /**
     * Safe version of once() that won't hang indefinitely
     */
    async once(timeoutMs: number = 5000): Promise<T> {
      try {
        // Create a timeout promise
        const timeoutPromise = new Promise<T>((_, reject) => {
          setTimeout(() => reject(new Error(`Gun once() timed out after ${timeoutMs}ms`)), timeoutMs);
        });
  
        // Race the Gun once with the timeout
        return await Promise.race([
          this._gunNode.once(),
          timeoutPromise
        ]);
      } catch (err) {
        console.error('Error in Gun once():', err);
        this._errorHandlers.forEach(handler => handler(err));
        throw err;
      }
    }
  
    dispose(): void {
      // Clean up Gun subscription
      this.pause();
      
      // Clear any pending operations
      this._pendingOperations = [];
      
      // Clear error handlers
      this._errorHandlers.clear();
      
      // Call parent dispose
      super.dispose();
    }
    
    // Expose GunNode methods that might be needed
    get gunNode(): GunNode<T> {
      return this._gunNode;
    }
    
    // Create a safer stream that properly handles GunSubscription lifecycle
    stream(): GunSubscription<T> {
      return this._gunNode.stream();
    }
    
    /**
     * Map values from this Gun node using the provided mapper function
     * @param mapFn Function to transform each value
     * @returns A new GunSubscription with mapped values
     */
    mapStream<R>(mapFn: (value: T) => R): GunSubscription<R> {
      return this._gunNode.stream().map(mapFn);
    }
    
    /**
     * For collections: Get each item in the collection
     * @returns A subscription to each item in the collection
     */
    eachStream(): GunSubscription {
      return this._gunNode.stream().each();
    }
    
    /**
     * Get the entire node as an object subscription
     * @param initialValue Optional initial object shape
     * @returns A subscription that emits the full object
     */
    objectStream(initialValue: Record<string, any> = {}): GunSubscription<Record<string, any>> {
      return this._gunNode.asObject(initialValue);
    }
    
    /**
     * Get a non-awaitable reference to the gun node
     * This prevents accidental awaiting of gun nodes when used in async contexts
     */
    get chain(): any { 
      return { 
        node: this._gunNode,
        getChain: () => this._gunNode.getChain()
      };
    }
  }
  
  /**
   * Base for reactive entities connected to Gun
   */
  export abstract class ReactiveEntity<T> {
    private _id: string;
    protected _reactives = new Map<string, Reactive<any>>();
    protected _computed = new Map<string, Computed<any>>();
    protected _subscriptions: SubscriptionCleanup[] = [];
    protected _app: App;
    protected _gunNode: GunNode<T>;
    protected _certificate: any = null;
    protected _disposed: boolean = false;
    protected _errorHandlers: Set<(error: any) => void> = new Set();
  
    constructor(id: string, app: App) {
      this._id = id;
      this._app = app;
      this._gunNode = new GunNode<T>(['entities', this.constructor.name.toLowerCase(), id]);
    }
  
    get id(): string {
      return this._id;
    }
    
    get gunNode(): GunNode<T> {
      return this._gunNode;
    }
    
    /**
     * Set a certificate to be used for writes to protected nodes
     */
    setCertificate(certificate: any): void {
      this._certificate = certificate;
    }
    
    /**
     * Add an error handler for this entity
     */
    onError(handler: (error: any) => void): () => void {
      this._errorHandlers.add(handler);
      return () => this._errorHandlers.delete(handler);
    }
    
    /**
     * Handle errors consistently
     */
    protected handleError(error: any, context: string): void {
      console.error(`Error in ${this.constructor.name}(${this._id}).${context}:`, error);
      this._errorHandlers.forEach(handler => {
        try {
          handler(error);
        } catch (err) {
          console.error('Error in error handler:', err);
        }
      });
    }
  
    protected defineReactiveProperty<K extends keyof T & string>(
      propertyName: K,
      initialValue: T[K],
      path: string[] = []
    ): void {
      // Check if already disposed
      if (this._disposed) {
        this.handleError(new Error('Cannot define property on disposed entity'), 'defineReactiveProperty');
        return;
      }
      
      try {
      // Determine whether to use Gun or local reactive
      if (path.length > 0) {
        // Create a ReactiveGun property that syncs with the database
        const reactiveGun = new ReactiveGun<T[K]>(path, initialValue);
        this._reactives.set(propertyName, reactiveGun);
          
          // Set up error handling
          reactiveGun.onError(err => this.handleError(err, `${propertyName}.reactiveGun`));
        
        // Define the property on this instance
        Object.defineProperty(this, propertyName, {
          get: () => reactiveGun.value,
            set: (value: T[K]) => { 
              try {
                reactiveGun.value = value; 
              } catch (err) {
                this.handleError(err, `${propertyName}.set`);
              }
            },
          enumerable: true,
          configurable: true
        });
      } else {
        // Create a local reactive property
        const reactive = new Reactive<T[K]>(initialValue);
        this._reactives.set(propertyName, reactive);
        
        // Define the property on this instance
        Object.defineProperty(this, propertyName, {
          get: () => reactive.value,
            set: (value: T[K]) => { 
              try {
                reactive.value = value; 
              } catch (err) {
                this.handleError(err, `${propertyName}.set`);
              }
            },
          enumerable: true,
          configurable: true
        });
        }
      } catch (err) {
        this.handleError(err, `defineReactiveProperty(${propertyName})`);
      }
    }
  
    protected defineComputedProperty<V>(
      propertyName: string,
      computer: () => V
    ): void {
      // Check if already disposed
      if (this._disposed) {
        this.handleError(new Error('Cannot define property on disposed entity'), 'defineComputedProperty');
        return;
      }
      
      try {
      // Create a computed property
      const computed = new Computed<V>(computer.bind(this) as () => V);
      this._computed.set(propertyName, computed);
      
      // Define the property on this instance
      Object.defineProperty(this, propertyName, {
          get: () => {
            try {
              return computed.value;
            } catch (err) {
              this.handleError(err, `${propertyName}.computed.get`);
              // Return a default value or throw to prevent undefined behavior
              throw err;
            }
          },
        enumerable: true,
        configurable: true
      });
      } catch (err) {
        this.handleError(err, `defineComputedProperty(${propertyName})`);
      }
    }

    /**
     * Put a value to the Gun node with certificate if available
     */
    protected putWithCertificate<V>(path: string[], value: V): void {
      try {
        // Build a path string to use with the gun variable directly
        const fullPath = ['entities', this.constructor.name.toLowerCase(), this._id, ...path];
        
        // Use certificate if available
        if (this._certificate) {
          const options = { opt: { cert: this._certificate } };
          Batch.scheduleGunUpdate(fullPath, value);
        } else {
          // Navigate to the path with gun
          let ref = gun as any;
          for (const segment of fullPath) {
            ref = ref.get(segment);
          }
          ref.put(value);
        }
      } catch (err) {
        this.handleError(err, `putWithCertificate(${path.join('/')})`);
      }
    }
  
    protected addSubscription(subscription: SubscriptionCleanup): void {
      // Check if already disposed
      if (this._disposed) {
        try {
          subscription(); // Clean up right away
        } catch (err) {
          this.handleError(err, 'addSubscription.cleanup');
        }
        return;
      }
      
      this._subscriptions.push(subscription);
    }
  
    getStore<K extends keyof T & string>(propertyName: K) {
      const reactive = this._reactives.get(propertyName);
      if (!reactive) {
        throw new Error(`No reactive property found with name: ${String(propertyName)}`);
      }
      
      return reactive.toStore();
    }
  
    getComputedStore(propertyName: string) {
      const computed = this._computed.get(propertyName);
      if (!computed) {
        throw new Error(`No computed property found with name: ${propertyName}`);
      }
      
      return computed.toStore();
    }
    
    /**
     * Check if this entity has been disposed
     */
    get isDisposed(): boolean {
      return this._disposed;
    }
  
    dispose(): void {
      if (this._disposed) return;
      this._disposed = true;
      
      // Clean up all subscriptions
      this._subscriptions.forEach(unsub => {
        try {
          unsub();
        } catch (err) {
          console.error('Error unsubscribing:', err);
        }
      });
      this._subscriptions = [];
      
      // Dispose all reactive properties
      this._reactives.forEach(reactive => {
        try {
          reactive.dispose();
        } catch (err) {
          console.error('Error disposing reactive:', err);
        }
      });
      this._reactives.clear();
      
      // Dispose all computed properties
      this._computed.forEach(computed => {
        try {
          computed.dispose();
        } catch (err) {
          console.error('Error disposing computed:', err);
        }
      });
      this._computed.clear();
      
      // Clear error handlers
      this._errorHandlers.clear();
    }

    /**
     * Get a Gun subscription for a reactive property
     * Allows streaming access to property values
     * @param propertyName Name of the property to access
     * @returns GunSubscription for the property if it's Gun-backed
     */
    getPropertyStream<K extends keyof T & string>(propertyName: K): GunSubscription<T[K]> {
      if (this._disposed) {
        throw new Error('Cannot get subscription from disposed entity');
      }
      
      const reactive = this._reactives.get(propertyName);
      if (reactive instanceof ReactiveGun) {
        return reactive.stream();
      }
      
      throw new Error(`Property ${String(propertyName)} is not a Gun-backed reactive property`);
    }
    
    /**
     * Get a Gun-like subscription for a computed property
     * @param propertyName Name of the computed property
     * @returns A GunSubscription-compatible object for the computed property
     */
    getComputedStream<R>(propertyName: string): { on: (handler: (value: R) => void) => () => void } {
      if (this._disposed) {
        throw new Error('Cannot get subscription from disposed entity');
      }
      
      const computed = this._computed.get(propertyName);
      if (!computed) {
        throw new Error(`No computed property found with name: ${propertyName}`);
      }
      
      return {
        on: (handler: (value: R) => void) => {
          // Call handler with current value
          handler(computed.value as R);
          
          // Set up subscription for future changes
          const cleanup = computed.subscribe((value) => {
            handler(value as R);
          });
          
          // Store cleanup for later
          this._subscriptions.push(cleanup);
          
          // Return cleanup function
          return () => {
            // Find and remove this specific subscription
            const index = this._subscriptions.indexOf(cleanup);
            if (index >= 0) {
              this._subscriptions.splice(index, 1);
            }
            // Call actual cleanup
            cleanup();
          };
        }
      };
    }
    
    /**
     * Map children in a collection to get their property values as a stream
     * @param collectionPath Path to the child collection relative to this entity
     * @param childProperty Property to access on each child
     * @returns Subscription that emits arrays of property values
     */
    getChildrenPropertyStream<R>(collectionPath: string, childProperty: string): GunSubscription<R[]> {
      if (this._disposed) {
        throw new Error('Cannot access children of disposed entity');
      }
      
      // Create a node for the collection
      const collectionNode = this._gunNode.get(collectionPath);
      
      // Use the each() method to get all children
      const eachSub = collectionNode.stream().each();
      
      // Create a wrapper subscription that collects property values
      const resultSub = new GunSubscription<R[]>([]);
      
      // Track values by key
      const valueMap = new Map<string, R>();
      
      // Setup the on method
      resultSub.on = (handler: (values: R[]) => void) => {
        // Initial call with empty array
        handler(Array.from(valueMap.values()));
        
        // Subscribe to child updates
        const cleanup = eachSub.on((data) => {
          if (!data || typeof data !== 'object') return;
          
          // Handle removals
          if (data._removed) {
            valueMap.delete(data._key);
          } 
          // Handle updates
          else if (childProperty in data) {
            valueMap.set(data._key, data[childProperty] as R);
          }
          
          // Notify with current values
          handler(Array.from(valueMap.values()));
        });
        
        // Store for cleanup
        this._subscriptions.push(cleanup);
        
        // Return cleanup function
        return () => {
          const index = this._subscriptions.indexOf(cleanup);
          if (index >= 0) {
            this._subscriptions.splice(index, 1);
          }
          cleanup();
        };
      };
      
      return resultSub;
    }
  }
  

// Export additional utility functions
export function reactive<T>(initialValue: T): Reactive<T> {
  return new Reactive<T>(initialValue);
}

export function computed<T>(computer: () => T): Computed<T> {
  return new Computed<T>(computer);
}

/**
 * Safely await a Gun node without hanging indefinitely
 * @param gunNode The Gun node to await
 * @param timeoutMs Timeout in milliseconds
 * @returns Promise that resolves with the value or rejects with timeout
 */
export async function safeAwait<T>(
  gunNode: any, 
  timeoutMs: number = 5000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Gun await timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    // Check if gunNode has promise-like behavior
    if (gunNode && typeof gunNode.then === 'function') {
      gunNode.then((value: T) => {
        clearTimeout(timeout);
        resolve(value);
      }).catch((err: any) => {
        clearTimeout(timeout);
        reject(err);
      });
    } else {
      // Not awaitable, use once() if available
      if (gunNode && typeof gunNode.once === 'function') {
        gunNode.once((data: T) => {
          clearTimeout(timeout);
          resolve(data);
        });
      } else {
        clearTimeout(timeout);
        reject(new Error('Object is not awaitable and has no once() method'));
      }
    }
  });
}

/**
 * Create a reactive value connected to Gun with a safe path
 * @param path Path to the Gun node
 * @param initialValue Initial value to use until data loads
 * @returns A ReactiveGun instance
 */
export function reactiveGun<T>(path: string[], initialValue: T): ReactiveGun<T> {
  return new ReactiveGun<T>(path, initialValue);
}

/**
 * Create a Gun node with a certificate for write access
 * @param node Base Gun node
 * @param certificate Certificate for write access
 * @returns Function that creates write operations with the certificate
 */
export function withCertificate(node: any, certificate: any) {
  const options = { opt: { cert: structuredClone(certificate) } };
  
  return {
    put: <T>(value: T) => {
      try {
        node.put(value, null, structuredClone(options));
        return true;
      } catch (err) {
        console.error('Error in certificated put:', err);
        return false;
      }
    },
    get: (key: string) => {
      return withCertificate(node.get(key), certificate);
    }
  };
}

/**
 * Safely get a Gun node as a non-awaitable reference
 * This prevents accidental awaiting when used in async contexts
 * @param gunNode Gun node to wrap
 * @returns Object with methods to access the underlying Gun node
 */
export function nonAwaitableNode<T>(gunNode: any) {
  return {
    node: gunNode,
    get: (key: string) => nonAwaitableNode(gunNode.get(key)),
    put: (value: T) => gunNode.put(value),
    putWithCert: (value: T, certificate: any) => {
      const options = { opt: { cert: structuredClone(certificate) } };
      gunNode.put(value, null, structuredClone(options));
    },
    once: () => gunNode.once(),
    on: (callback: (data: T) => void) => gunNode.on(callback),
    map: () => nonAwaitableNode(gunNode.map())
  };
}

/**
 * Create a cache that automatically invalidates based on Gun updates
 * @param compute Function to compute the cached value
 * @param watchPath Gun path to watch for invalidations
 * @returns Object with methods to access and manage the cache
 */
export function createGunCache<K, V>(
  compute: (key: K) => V,
  watchPath?: string[]
): {
  get: (key: K) => V,
  invalidate: (key?: K) => void,
  clear: () => void
} {
  const cache = new ComputationCache<K, V>(compute);
  
  // Set up invalidation if path provided
  if (watchPath) {
    const node = new GunNode(watchPath);
    const subscription = node.on(() => {
      // Invalidate entire cache when Gun node changes
      cache.clear();
    });
    
    // Clean up on window unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        subscription();
      });
    }
  }
  
  return {
    get: (key: K) => cache.get(key),
    invalidate: (key?: K) => cache.invalidate(key),
    clear: () => cache.clear()
  };
}

