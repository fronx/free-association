import { gun, getNodeRef, getTransientNodeRef, user, transientUser } from './gunSetup';
import type { GunData } from './gunSetup';
import { GunSubscription } from './GunSubscription';
import type { SubscriptionCleanup, SubscriptionHandler } from './gunSetup';
import { GunSpace, type GunPathSpec } from './gunSetup';

/**
 * Base class for Gun node wrappers that provides a consistent API
 * Following the guide's recommendations for wrapping Gun functionality
 */
export class GunNode<T = any> {
	protected chain: any;
	protected path: string[];
	protected pathSpec: GunPathSpec;
	private certificate?: string;
	private isTransient: boolean;

	/**
	 * Create a new Gun node wrapper with space awareness
	 * @param pathOrSpec Path segments or a complete path specification
	 * @param certificate Optional certificate for write access
	 * @param transient If true, use transientGun which doesn't persist to localStorage
	 */
	constructor(
		pathOrSpec: string[] | GunPathSpec,
		certificate?: string,
		transient: boolean = false
	) {
		// Handle path or pathSpec input
		if (Array.isArray(pathOrSpec)) {
			// Convert simple path to pathSpec
			this.path = [...pathOrSpec]; // Create a copy
			this.pathSpec = {
				segments: this.path,
				space: GunSpace.PUBLIC
			};

			// Use old method for backward compatibility
			this.chain = transient ? getTransientNodeRef(this.path) : getNodeRef(this.path);
		} else {
			// Use provided pathSpec
			this.pathSpec = { ...pathOrSpec }; // Create a copy
			this.path = [...this.pathSpec.segments];

			// Use the new space-aware method
			this.chain = this.getSpaceAwareRef(transient);
		}

		this.certificate = certificate;
		this.isTransient = transient;
	}

	/**
	 * Get the appropriate Gun reference based on space
	 */
	private getSpaceAwareRef(transient: boolean): any {
		// Get the base Gun instance
		const gunInstance = transient ? getTransientNodeRef(this.path) : getNodeRef(this.path);
		const userInstance = transient ? transientUser : user;

		let ref;

		// Set up the base reference based on space
		switch (this.pathSpec.space) {
			case GunSpace.USER:
				if (this.pathSpec.ownerPub) {
					// Specific user's space - use gun.user(pub)
					ref = gunInstance.user(this.pathSpec.ownerPub);
				} else if (userInstance.is?.pub) {
					// Current authenticated user's space
					ref = userInstance;
				} else {
					console.warn('No user specified or authenticated. Falling back to public space.');
					ref = gunInstance;
				}
				break;

			case GunSpace.FROZEN:
				// Frozen space with tag
				if (this.pathSpec.tag) {
					ref = gunInstance.get(`#${this.pathSpec.tag}`);
				} else {
					ref = gunInstance;
				}
				break;

			case GunSpace.PUBLIC:
			default:
				ref = gunInstance;
		}

		// Navigate path segments
		for (const segment of this.pathSpec.segments) {
			ref = ref.get(segment);
		}

		return ref;
	}

	/**
	 * Get a child node at the given path, preserving space context
	 */
	public get<R = any, N extends GunNode<R> = GunNode<R>>(
		key: string,
		NodeClass: new (
			pathSpec: GunPathSpec | string[],
			certificate?: string,
			transient?: boolean
		) => N = GunNode as any
	): N {
		// Create a new pathSpec with the child key
		const childPathSpec: GunPathSpec = {
			...this.pathSpec,
			segments: [...this.pathSpec.segments, key]
		};

		return new NodeClass(childPathSpec, this.certificate, this.isTransient);
	}

	/**
	 * Put a value to the Gun node with space-aware permissions
	 */
	public put(value: Partial<T>, options?: any): this {
		// Apply certificate if available
		if (this.certificate) {
			options = options || {};
			options.opt = options.opt || {};
			options.opt.cert = this.certificate;
		}

		// Space-specific validation
		if (this.pathSpec.space === GunSpace.USER) {
			const currentPub = user.is?.pub;

			// Check if we're in a different user's space without a certificate
			if (this.pathSpec.ownerPub && this.pathSpec.ownerPub !== currentPub && !this.certificate) {
				console.error(
					`Cannot put to another user's space without a certificate. Target: ${this.pathSpec.ownerPub}, Current: ${currentPub}`
				);
				return this;
			}

			// Check if we're trying to write to user space while not authenticated
			if (!this.pathSpec.ownerPub && !currentPub) {
				console.error('Cannot put to user space: Not authenticated');
				return this;
			}
		} else if (this.pathSpec.space === GunSpace.FROZEN && !this.certificate) {
			console.warn('Writing to frozen space typically requires a certificate');
		}

		const opts = options ? structuredClone(options) : null;
		this.chain.put(value, null, opts);
		return this;
	}

	/**
	 * Change the space this node operates in
	 */
	public inSpace(space: GunSpace, ownerPub?: string, tag?: string): GunNode<T> {
		const newPathSpec: GunPathSpec = {
			segments: this.path,
			space,
			ownerPub,
			tag
		};

		return new GunNode<T>(newPathSpec, this.certificate, this.isTransient);
	}

	/**
	 * Get the space this node operates in
	 */
	public getSpace(): GunSpace {
		return this.pathSpec.space;
	}

	/**
	 * Get a path specification object for this node
	 */
	public getPathSpec(): GunPathSpec {
		return { ...this.pathSpec };
	}

	/**
	 * Subscribe to updates from this node
	 * @param handler Function to call with updates
	 * @returns A function to unsubscribe
	 */
	public on(handler: SubscriptionHandler<T>): SubscriptionCleanup {
		// console.log('[DEBUG GunNode] Setting up direct .on subscription', {
		//   path: this.path.join('/')
		// });
		const subscription = new GunSubscription<T>(this.path);
		return subscription.on(handler);
	}

	/**
	 * Get a single value from the node and resolve
	 * @returns Promise that resolves with the node value
	 */
	public once(): Promise<T> {
		// console.log('[DEBUG GunNode] Getting value once', {
		//   path: this.path.join('/')
		// });

		return new Promise<T>((resolve, reject) => {
			// Create a timeout to avoid hanging forever
			const timeout = setTimeout(() => {
				reject(new Error('Gun once() timed out after 10 seconds'));
			}, 10000);

			this.chain.once((data: T) => {
				clearTimeout(timeout);
				// console.log('[DEBUG GunNode] Received value from once()', {
				//   path: this.path.join('/'),
				//   data
				// });
				resolve(data);
			});
		});
	}

	/**
	 * Get a readable stream of values from this node
	 * @returns A subscription that can be used as a stream
	 */
	public stream(): GunSubscription<T> {
		// console.log('[DEBUG GunNode] Creating stream subscription', {
		//   path: this.path.join('/')
		// });
		return new GunSubscription<T>(this.path);
	}

	/**
	 * Subscribe to all values in this node (for collections)
	 * @param handler Function to call with each item
	 * @returns A function to unsubscribe
	 */
	public each(handler: SubscriptionHandler<any>): SubscriptionCleanup {
		// console.log('[DEBUG GunNode] Setting up .each() subscription for collection', {
		//   path: this.path.join('/')
		// });
		const subscription = new GunSubscription(this.path);
		const eachSub = subscription.each();
		// console.log('[DEBUG GunNode] Created .each() subscription, now setting up handler');
		return eachSub.on(handler);
	}

	/**
	 * Subscribe to filtered values in this node that match the predicate
	 * @param predicate Function that tests each value, returns true to include the value
	 * @param handler Function to call with each matching item
	 * @returns A function to unsubscribe
	 */
	public filter(
		predicate: (value: any) => boolean,
		handler: SubscriptionHandler<any>
	): SubscriptionCleanup {
		const subscription = new GunSubscription(this.path);
		const filteredSub = subscription.filter(predicate);
		return filteredSub.on(handler);
	}

	/**
	 * Set a certificate for this node and all child nodes accessed through it
	 * @param certificate The certificate string
	 * @returns This node instance for chaining
	 */
	public withCertificate(certificate: string): this {
		this.certificate = certificate;
		return this;
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
	 * Get the Svelte-compatible store directly from Gun
	 * Returns the raw Gun chain which has the .subscribe method from gunSetup
	 *
	 * @returns A Svelte-compatible store for the current node
	 */
	public toStore() {
		// Return the raw Gun chain which has subscribe method from gunSetup
		return this.chain;
	}

	/**
	 * Get the full path to this node as an array
	 * @returns Array of path segments
	 */
	public getPath(): string[] {
		return [...this.path]; // Return a copy
	}

	/**
	 * Get the Soul (unique identifier) of this node if it has one
	 * @returns Promise that resolves with the Soul string or undefined
	 */
	public async getSoul(): Promise<string | undefined> {
		try {
			const data = (await this.once()) as GunData;
			if (data && data._ && data._['#']) {
				return data._['#'];
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
			return Boolean(data && Object.keys(data).filter((k) => k !== '_').length > 0);
		} catch (err) {
			return false;
		}
	}

	/**
	 * Get the raw Gun chain
	 * @returns The raw Gun chain
	 */
	public getChain(): any {
		return this.chain;
	}

	// ===== DEEP REFERENCE TRAVERSAL METHODS =====

	/**
	 * Enhanced soul reference check that recognizes different space formats
	 */
	private isSoulReference(value: any): boolean {
		return (
			value &&
			typeof value === 'object' &&
			Object.keys(value).length === 1 &&
			value['#'] !== undefined
		);
	}

	/**
	 * Resolve a reference with space awareness
	 */
	private async resolveReference(value: any): Promise<any> {
		if (!this.isSoulReference(value)) {
			return value;
		}

		// It's a soul reference, extract the soul
		const soul = value['#'];

		return new Promise<any>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Reference resolution timed out for soul: ${soul}`));
			}, 10000);

			// Choose the appropriate resolution method based on soul format
			if (soul.startsWith('~')) {
				// User space reference
				gun.get(soul).once((userData: any) => {
					// Use get with full soul instead of user()
					clearTimeout(timeout);
					resolve(userData);
				});
			} else if (soul.startsWith('#')) {
				// Frozen space reference
				gun.get(soul).once((frozenData: any) => {
					clearTimeout(timeout);
					resolve(frozenData);
				});
			} else {
				// Public space reference
				gun.get(soul).once((publicData: any) => {
					clearTimeout(timeout);
					resolve(publicData);
				});
			}
		});
	}

	/**
	 * Deep get that automatically resolves references to a specified depth
	 * @param maxDepth Maximum depth to resolve references (default: 1)
	 * @returns Promise resolving to the deeply resolved data
	 */
	public async deepGet(maxDepth: number = 1): Promise<any> {
		if (maxDepth <= 0) {
			return this.once();
		}

		try {
			// Get the initial data
			const data = await this.once();

			// If it's null or not an object, just return it
			if (!data || typeof data !== 'object') {
				return data;
			}

			// Start processing the object, resolving references recursively
			return this.resolveReferencesDeep(data, maxDepth);
		} catch (err) {
			console.error('Error in deepGet:', err);
			throw err;
		}
	}

	/**
	 * Recursively resolve all references in an object
	 * @param obj The object to process
	 * @param maxDepth Maximum depth to resolve references
	 * @param currentDepth Current recursion depth
	 * @returns The processed object with resolved references
	 */
	private async resolveReferencesDeep(
		obj: any,
		maxDepth: number,
		currentDepth: number = 0
	): Promise<any> {
		// Base case: we've reached max depth or it's not an object
		if (currentDepth >= maxDepth || !obj || typeof obj !== 'object') {
			return obj;
		}

		// Special handling for Gun metadata
		if (obj._ && typeof obj._ === 'object') {
			// Keep the underscore metadata intact
			const result: Record<string, any> = { _: obj._ };

			// Process all other properties
			for (const key of Object.keys(obj)) {
				if (key === '_') continue;

				const value = obj[key];

				if (this.isSoulReference(value)) {
					// It's a reference, resolve it
					try {
						const resolved = await this.resolveReference(value);
						// Continue deeper with resolved value
						result[key] = await this.resolveReferencesDeep(resolved, maxDepth, currentDepth + 1);
					} catch (err) {
						console.warn(`Failed to resolve reference for key ${key}:`, err);
						// Keep the reference if resolution fails
						result[key] = value;
					}
				} else if (Array.isArray(value)) {
					// Handle arrays
					result[key] = await Promise.all(
						value.map((item) => this.resolveReferencesDeep(item, maxDepth, currentDepth + 1))
					);
				} else if (value && typeof value === 'object') {
					// Recursive case for nested objects
					result[key] = await this.resolveReferencesDeep(value, maxDepth, currentDepth + 1);
				} else {
					// Base case for primitive values
					result[key] = value;
				}
			}

			return result;
		} else if (this.isSoulReference(obj)) {
			// It's a direct reference
			try {
				const resolved = await this.resolveReference(obj);
				return this.resolveReferencesDeep(resolved, maxDepth, currentDepth + 1);
			} catch (err) {
				console.warn('Failed to resolve direct reference:', err);
				return obj;
			}
		} else {
			// Regular object case
			const result: Record<string, any> = Array.isArray(obj) ? ([] as any) : {};

			for (const key of Object.keys(obj)) {
				const value = obj[key];

				if (this.isSoulReference(value)) {
					// It's a reference, resolve it
					try {
						const resolved = await this.resolveReference(value);
						// Continue deeper with resolved value
						result[key] = await this.resolveReferencesDeep(resolved, maxDepth, currentDepth + 1);
					} catch (err) {
						console.warn(`Failed to resolve reference for key ${key}:`, err);
						// Keep the reference if resolution fails
						result[key] = value;
					}
				} else if (Array.isArray(value)) {
					// Handle arrays
					result[key] = await Promise.all(
						value.map((item) => this.resolveReferencesDeep(item, maxDepth, currentDepth + 1))
					);
				} else if (value && typeof value === 'object') {
					// Recursive case for nested objects
					result[key] = await this.resolveReferencesDeep(value, maxDepth, currentDepth + 1);
				} else {
					// Base case for primitive values
					result[key] = value;
				}
			}

			return result;
		}
	}

	/**
	 * Create a subscription that automatically resolves references
	 * @param maxDepth Maximum depth to resolve references (default: 1)
	 * @returns A subscription that emits deeply resolved data
	 */
	public deepStream(maxDepth: number = 1): GunSubscription<any> {
		// Create a regular subscription
		const baseSubscription = this.stream();

		// Map values through the deep resolver
		return baseSubscription.map(async (value) => {
			// Skip null/undefined values
			if (value === null || value === undefined) {
				return value;
			}

			try {
				return await this.resolveReferencesDeep(value, maxDepth);
			} catch (err) {
				console.error('Error in deepStream:', err);
				return value; // Return original value on error
			}
		});
	}

	/**
	 * Subscribe to deeply resolved updates
	 * @param handler Function to call with updates
	 * @param maxDepth Maximum depth to resolve references (default: 1)
	 * @returns A function to unsubscribe
	 */
	public deepOn(handler: SubscriptionHandler<any>, maxDepth: number = 1): SubscriptionCleanup {
		return this.deepStream(maxDepth).on(handler);
	}
}

/**
 * Factory methods for creating GunNode instances in different spaces
 */
export class GunNodeFactory {
	/**
	 * Create a node in public space
	 */
	static public<T = any>(
		path: string[],
		certificate?: string,
		transient: boolean = false
	): GunNode<T> {
		return new GunNode<T>({ segments: path, space: GunSpace.PUBLIC }, certificate, transient);
	}

	/**
	 * Create a node in current user's space
	 */
	static user<T = any>(
		path: string[],
		certificate?: string,
		transient: boolean = false
	): GunNode<T> {
		return new GunNode<T>({ segments: path, space: GunSpace.USER }, certificate, transient);
	}

	/**
	 * Create a node in a specific user's space
	 */
	static userSpace<T = any>(
		userPub: string,
		path: string[],
		certificate?: string,
		transient: boolean = false
	): GunNode<T> {
		return new GunNode<T>(
			{ segments: path, space: GunSpace.USER, ownerPub: userPub },
			certificate,
			transient
		);
	}

	/**
	 * Create a node in frozen space with a tag
	 */
	static frozen<T = any>(
		tag: string,
		path: string[] = [],
		certificate?: string,
		transient: boolean = false
	): GunNode<T> {
		return new GunNode<T>({ segments: path, space: GunSpace.FROZEN, tag }, certificate, transient);
	}

	/**
	 * Create a node from a soul string
	 */
	static fromSoul<T = any>(
		soul: string,
		certificate?: string,
		transient: boolean = false
	): GunNode<T> {
		if (soul.startsWith('~')) {
			// User space soul
			const parts = soul.substring(1).split('/');
			const userPub = parts[0];
			const path = parts.slice(1);

			return this.userSpace<T>(userPub, path, certificate, transient);
		} else if (soul.startsWith('#')) {
			// Frozen space soul
			const tag = soul.substring(1);

			return this.frozen<T>(tag, [], certificate, transient);
		} else {
			// Public space soul
			return this.public<T>([soul], certificate, transient);
		}
	}
}
