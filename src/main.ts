import { Coordinator } from './Coordinator';
import Treemap from './components/treemap/Treemap.svelte';
import { createNodeTreeStore } from './models/NodeStore';
import { get } from 'svelte/store';
import { user, recallUser, authenticate, logout } from './models/Gun';
import type { SvelteComponent } from 'svelte';
import './style.css';

let coordinatorApp: Coordinator | null = null;

// Initialize function that handles recall and app initialization
async function initializeApp() {
    console.log('Starting app initialization...');    
    console.log('Attempting to recall user session');
    await recallUser();

    // Check if the user is authenticated after recall
    if (user.is && user.is.pub) {
        console.log('User session recalled successfully', user.is.pub);
        const authContainer = document.getElementById('auth-container');
        if (authContainer) {
            authContainer.classList.add('hidden');
        }
        
        // Show the visualization container
        const visualizationContainer = document.querySelector('.visualization-container');
        if (visualizationContainer) {
            (visualizationContainer as HTMLElement).style.display = 'grid';
        }
        
        try {
            console.log('Initializing coordinator with authenticated user');
            coordinatorApp = new Coordinator();
            await coordinatorApp.initialize();
            console.log('Coordinator initialized after session recall');
            
            // Only mount components after initialization
            mountComponents();
        } catch (error) {
            console.error('Failed to initialize coordinator after session recall:', error);
            // Show auth container if app initialization fails
            if (authContainer) {
                authContainer.classList.remove('hidden');
            }
            // Hide the visualization container
            if (visualizationContainer) {
                (visualizationContainer as HTMLElement).style.display = 'none';
            }
        }
    } else {
        console.log('No valid user session found, showing login form');
        // Show auth container if no user session
        const authContainer = document.getElementById('auth-container');
        if (authContainer) {
            authContainer.classList.remove('hidden');
        }
        
        // Hide the visualization container
        const visualizationContainer = document.querySelector('.visualization-container');
        if (visualizationContainer) {
            (visualizationContainer as HTMLElement).style.display = 'none';
        }
    }
}

// Handle authentication form submission
async function handleAuth(event: Event) {
    event.preventDefault();
    console.log('Auth handler started');
    const username = (document.getElementById('username') as HTMLInputElement).value;
    const password = (document.getElementById('password') as HTMLInputElement).value;

    try {
        await authenticate(username, password);
        console.log('Login successful');
    } catch(error) {
        console.log('Auth failed:', error);
        alert('Authentication failed. Please try again.');
        return;
    }

    const authContainer = document.getElementById('auth-container');
    if (!authContainer) {
        console.error('Auth container not found');
        return;
    }
    authContainer.classList.add('hidden');
    console.log('Auth container hidden');

    // Show the visualization container
    const visualizationContainer = document.querySelector('.visualization-container');
    if (visualizationContainer) {
        (visualizationContainer as HTMLElement).style.display = 'grid';
    }

    try {
        // Initialize coordinator with proper await
        coordinatorApp = new Coordinator();
        await coordinatorApp.initialize();
        console.log('Coordinator initialized successfully');

        // Mount components after initialization
        mountComponents();
    } catch (error) {
        console.error('Failed to initialize coordinator:', error);
    }
}

// Function to mount Svelte components after successful initialization
function mountComponents() {
    console.log('[main] mountComponents - Starting component mounting');
    
    if (!coordinatorApp) {
        console.error('[main] mountComponents - Coordinator not initialized');
            return;
        }
    
    console.log('[main] mountComponents - Mounting Treemap component');
    
    // Get the root node store
    const rootStore = get(coordinatorApp.rootStore);
    
    if (!rootStore) {
        console.error('[main] mountComponents - Root store not available');
            return;
        }
        
    console.log('[main] mountComponents - Root store retrieved:', rootStore);
    console.log('[main] mountComponents - Root node properties:', {
        id: rootStore.nodeRef.id,
        name: rootStore.nodeRef.name,
        points: rootStore.nodeRef.points,
        children: rootStore.nodeRef.children ? Array.from(rootStore.nodeRef.children.values()).length : 0
    });
    
    // Listen for name changes to demonstrate reactivity
    const nameStore = rootStore.property('name');
    nameStore.subscribe(name => {
        console.log('[main] Root node name changed:', name);
    });
    
    // Mount the Treemap component
    const target = document.getElementById('treemap-container');
    if (!target) {
        console.error('[main] mountComponents - Treemap container not found');
            return;
        }
        
    console.log('[main] mountComponents - Treemap container found with dimensions:', {
        width: target.clientWidth,
        height: target.clientHeight
    });
    
    // Need to use constructor pattern until the project is updated for Svelte 5 
    // TypeScript is confused about the component api version
    try {
        console.log('[main] mountComponents - Creating Treemap component');
        
        const treemap = new (Treemap as any)({
            target,
            props: {
                data: rootStore,
                width: window.innerWidth - 40,
                height: window.innerHeight - 40
            }
        });
        
        console.log('[main] mountComponents - Treemap component created successfully');
        
        // Register the treemap with the coordinator
        coordinatorApp.registerComponent('treemap', treemap);
        console.log('[main] mountComponents - Treemap component registered with coordinator');
        
        // Set up window resize handler
        window.addEventListener('resize', () => {
            console.log('[main] Window resize - Updating Treemap dimensions');
            treemap.$set({
                width: window.innerWidth - 40,
                height: window.innerHeight - 40
            });
        });

        // Clean up on unload
        window.addEventListener('beforeunload', () => {
            console.log('[main] Window unload - Cleaning up components');
            if (treemap.$destroy) treemap.$destroy();
            if (coordinatorApp) coordinatorApp.destroy();
        });
    } catch (error) {
        console.error('[main] mountComponents - Error creating Treemap component:', error);
    }
}

// Logout handler
function handleLogout() {
    if (coordinatorApp) {
        coordinatorApp.destroy();
        coordinatorApp = null;
    }
        logout();
        location.reload(); // Refresh the page to show login screen
}

// Wait for DOM to be fully loaded before attaching event listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded');
    
    // Try to initialize the app with recalled user session
    initializeApp();
    
    // Attach auth form submission event
    const authForm = document.getElementById('auth-form');
    if (authForm) {
        authForm.addEventListener('submit', handleAuth);
    } else {
        console.error('Auth form not found in DOM');
    }
    
    // Attach logout handler
    const logoutButton = document.getElementById('logout');
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
});

// Handle errors during initialization
window.onerror = (msg, url, line, col, error) => {
    console.error('Global error:', { msg, url, line, col, error });
    return false;
};

