# Integrating ReactTreeNode with Svelte

This document explains our approach to creating an elegant and maintainable integration between the ReactTreeNode reactive system and Svelte's store-based reactivity.

## Overview

We've created a bridge between the reactive properties of ReactTreeNode and Svelte's store system. This provides several benefits:

1. **One-way data flow**: Changes in ReactTreeNode automatically flow to Svelte components
2. **No duplicated state**: We maintain a single source of truth in the ReactTreeNode model
3. **Fine-grained reactivity**: Only components that depend on changed data re-render
4. **Clean separation of concerns**: Model logic stays in ReactTreeNode, UI logic in Svelte

## Key Components

### NodeStore

The `NodeStore` class wraps a ReactTreeNode and exposes its properties as Svelte stores:

```typescript
// Create a store for a node
const nodeStore = createNodeTreeStore(reactTreeNode);

// Access a property as a Svelte store
const nameStore = nodeStore.property('name');

// Subscribe to changes
nameStore.subscribe(name => console.log(`Name changed to: ${name}`));

// Get child stores
const childrenStore = nodeStore.children;
```

### Coordinator Improvements

The Coordinator now serves as a lightweight connection between ReactTreeNode and Svelte components:

1. It initializes the ReactTreeNode data model
2. It provides NodeStore instances for components
3. It handles registration of Svelte components
4. It ensures proper cleanup when components are destroyed

### Svelte Component Usage

Components can now accept either raw ReactTreeNode objects or NodeStore wrappers:

```svelte
<script>
  // Support both ReactTreeNode and NodeStore
  export let data;
  
  // Extract the ReactTreeNode if using NodeStore
  const reactNode = data instanceof Object && 'nodeRef' in data 
    ? data.nodeRef 
    : data;
    
  // Subscribe to changes if using NodeStore
  let nodeName = reactNode.name;
  let nameUnsubscribe;
  
  if ('nodeRef' in data) {
    const nameStore = data.property('name');
    nameUnsubscribe = nameStore.subscribe(value => {
      nodeName = value;
    });
  }
  
  onDestroy(() => {
    if (nameUnsubscribe) nameUnsubscribe();
  });
</script>
```

### NodeAggregator

For complex derived state from multiple nodes, we provide the `NodeAggregator`:

```typescript
// Create an aggregator that sums values
const ageAggregator = new NodeAggregator(
  (values) => values.reduce((sum, age) => sum + age, 0)
);

// Add stores to track
const unsub1 = ageAggregator.add('node1', node1Store.property('age'));
const unsub2 = ageAggregator.add('node2', node2Store.property('age'));

// Get the aggregated result as a store
const totalAge = ageAggregator.result;
```

## Benefits Over Previous Approach

1. **Less code**: The previous approach required tracking subscriptions and update flags manually
2. **More reactive**: Changes flow automatically without needing explicit tracking
3. **Easier component development**: Components can access reactive data through familiar Svelte stores
4. **Better lifecycle management**: Subscriptions are automatically cleaned up
5. **Superior composition**: Components can be composed with stores passed as props

## Example Usage

```typescript
// In main.ts
const coordinator = new Coordinator();
await coordinator.initialize();

// Get reactive NodeStore for root
const rootStore = get(coordinator.rootStore);

// Mount component with store
const treemap = new Treemap({
  target: document.getElementById('app'),
  props: {
    data: rootStore,
    width: 800,
    height: 600
  }
});

// In a Svelte component
function setNodeName(newName) {
  // If we have the node, we can modify it directly
  // The change will propagate to all components using the store
  reactNode.name = newName;
}
```

This approach brings together the best of both worlds: ReactTreeNode's powerful dependency tracking and reactive model with Svelte's elegant store-based component system. 