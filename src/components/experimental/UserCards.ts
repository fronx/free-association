import { gun } from '../../models/Gun';
import { App } from '../../App';
import { TreeNode } from '../../../../experiments/4-1-25-old/TreeNode';
import { getColorForName } from '../../utils/colorUtils';

// Could maybe be repurposed as a generic Cards component (for dragging and dropping nodes)

interface UserCardData {
  id: string;
  name: string;
  lastSeen: number;
}

export function createUserCardsGrid(app: App) {
  // Create container element
  const container = document.createElement('div');
  container.className = 'user-cards-grid';

  // Store user data
  const users: Map<string, UserCardData> = new Map();
  let currentHighlightedNode: Element | null = null;

  // Create styles
  const styles = document.createElement('style');
  styles.textContent = `
    .user-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
      gap: 10px;
      padding: 10px;
      max-height: 100%;
      overflow-y: auto;
      background: #f5f5f5;
      border-radius: 8px;
    }
    
    .user-card {
      aspect-ratio: 1;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 5px;
      cursor: grab;
      user-select: none;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
      position: relative;
      font-size: 12px;
      word-break: break-word;
      overflow: hidden;
    }
    
    .user-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    }
    
    .user-card.dragging {
      opacity: 0.7;
      transform: scale(0.95);
    }
    
    .user-card-inner {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 500;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    
    .highlighted-node {
      outline: 3px solid #2196F3 !important;
      outline-offset: -3px;
      transition: outline 0.2s ease;
    }
  `;
  document.head.appendChild(styles);

  // Function to fetch users from Gun
  function fetchUsers() {
    gun.get('users').map().on((userData: any, userId: string) => {
      if (userData && userId && userId !== app.rootId) {
        // Don't add current user to the grid
        const user = {
          id: userId,
          name: userData.name || 'Unknown',
          lastSeen: userData.lastSeen || 0
        };
        
        if (!users.has(userId)) {
          users.set(userId, user);
          createOrUpdateUserCard(user);
        } else if (JSON.stringify(users.get(userId)) !== JSON.stringify(user)) {
          users.set(userId, user);
          createOrUpdateUserCard(user);
        }
      }
    });
  }

  // Create or update a user card element
  function createOrUpdateUserCard(user: UserCardData) {
    let cardElement = container.querySelector(`[data-user-id="${user.id}"]`) as HTMLElement;
    
    if (!cardElement) {
      cardElement = document.createElement('div');
      cardElement.className = 'user-card';
      cardElement.setAttribute('data-user-id', user.id);
      cardElement.setAttribute('draggable', 'true');
      
      // Setup drag events
      cardElement.addEventListener('dragstart', handleDragStart);
      cardElement.addEventListener('dragend', handleDragEnd);
      
      container.appendChild(cardElement);
    }
    
    // Set/update background color based on name
    const bgColor = getColorForName(user.name);
    cardElement.style.backgroundColor = bgColor;
    
    // Update content
    cardElement.innerHTML = `<div class="user-card-inner">${user.name}</div>`;
  }

  // Handle drag start
  function handleDragStart(event: DragEvent) {
    if (event.target instanceof HTMLElement) {
      // Set drag data
      const userId = event.target.getAttribute('data-user-id') || '';
      event.dataTransfer?.setData('text/plain', userId);
      
      // Add visual feedback
      event.target.classList.add('dragging');
      
      // Setup treemap highlight handlers
      setupTreemapHighlight();
    }
  }

  // Handle drag end
  function handleDragEnd(event: DragEvent) {
    if (event.target instanceof HTMLElement) {
      event.target.classList.remove('dragging');
      resetTreemapHighlight();
    }
  }

  // Setup highlight handlers on treemap
  function setupTreemapHighlight() {
    const treemapContainer = document.getElementById('treemap-container');
    if (!treemapContainer) return;
    
    // Add event listeners to treemap container
    treemapContainer.addEventListener('dragover', handleTreemapDragOver);
    treemapContainer.addEventListener('dragleave', handleTreemapDragLeave);
    treemapContainer.addEventListener('drop', handleTreemapDrop);
  }

  // Remove highlight handlers from treemap
  function resetTreemapHighlight() {
    const treemapContainer = document.getElementById('treemap-container');
    if (!treemapContainer) return;
    
    // Remove event listeners
    treemapContainer.removeEventListener('dragover', handleTreemapDragOver);
    treemapContainer.removeEventListener('dragleave', handleTreemapDragLeave);
    treemapContainer.removeEventListener('drop', handleTreemapDrop);
    
    // Clear any remaining highlights
    if (currentHighlightedNode) {
      currentHighlightedNode.classList.remove('highlighted-node');
      currentHighlightedNode = null;
    }
  }

  // Handle drag over treemap
  function handleTreemapDragOver(event: DragEvent) {
    event.preventDefault();
    
    // Find the node element under the cursor
    const node = findNodeElementUnderCursor(event);
    
    // Reset previous highlight
    if (currentHighlightedNode && currentHighlightedNode !== node) {
      currentHighlightedNode.classList.remove('highlighted-node');
    }
    
    // Set new highlight
    if (node && node !== currentHighlightedNode) {
      node.classList.add('highlighted-node');
      currentHighlightedNode = node;
    }
  }

  // Handle drag leave treemap
  function handleTreemapDragLeave(event: DragEvent) {
    // Only remove highlight if we're actually leaving the treemap container
    if (event.target === event.currentTarget) {
      if (currentHighlightedNode) {
        currentHighlightedNode.classList.remove('highlighted-node');
        currentHighlightedNode = null;
      }
    }
  }

  // Handle drop on treemap
  function handleTreemapDrop(event: DragEvent) {
    event.preventDefault();
    
    // Get the userId from the drag data
    const userId = event.dataTransfer?.getData('text/plain');
    
    if (!userId) return;
    
    // Find the node under the cursor
    const nodeElement = findNodeElementUnderCursor(event);
    
    if (nodeElement) {
      // Get the node data
      const nodeId = nodeElement.getAttribute('id')?.replace('leaf-', '') || '';
      
      if (nodeId) {
        // Add the user as a type to the node
        addUserAsType(userId, nodeId);
        
        // Remove highlight
        nodeElement.classList.remove('highlighted-node');
        currentHighlightedNode = null;
      }
    }
  }

  // Helper to find the node element under cursor
  function findNodeElementUnderCursor(event: DragEvent): Element | null {
    // Get elements at point
    const x = event.clientX;
    const y = event.clientY;
    const elements = document.elementsFromPoint(x, y);
    
    // Find the first rect element that's a child of the treemap
    for (const element of elements) {
      if (element.tagName.toLowerCase() === 'rect' && 
          element.id && 
          element.id.startsWith('leaf-')) {
        return element;
      }
    }
    
    return null;
  }

  // Add user as type to node
  function addUserAsType(userId: string, nodeId: string) {
    console.log(`Adding user ${userId} as type to node ${nodeId}`);
    
    // Find the node in our app
    const node = findNodeById(app.rootNode, nodeId);
    
    if (node) {
      // Add the user as a type
      node.addType(userId);
      console.log(`Added user ${userId} as type to node ${node.name}`);
    } else {
      console.error(`Could not find node with ID ${nodeId}`);
    }
  }

  // Helper to find a node by ID
  function findNodeById(rootNode: TreeNode | null, id: string): TreeNode | null {
    if (!rootNode) return null;
    
    if (rootNode.id === id) {
      return rootNode;
    }
    
    // Search children
    for (const child of rootNode.children.values()) {
      const result = findNodeById(child, id);
      if (result) return result;
    }
    
    return null;
  }

  // Initialize
  fetchUsers();

  return {
    element: container,
    refresh: fetchUsers
  };
} 