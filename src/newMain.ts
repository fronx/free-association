import { user, recallUser, authenticate, logout } from './models/Gun';
import { Coordinator } from './Coordinator';
import TreeMap from './components/TreeMap.svelte';
import './style.css';
import $ from 'jquery';
import encodeQR from '@paulmillr/qr';
import decodeQR from '@paulmillr/qr/decode.js';

let coordinator: Coordinator | undefined;
let treeMapComponent: TreeMap | undefined;

// Initialize function that handles recall and coordinator initialization
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
        
        try {
            console.log('Initializing coordinator with authenticated user');
            coordinator = new Coordinator();
            await coordinator.initialize();
            console.log('Coordinator initialized after session recall:', coordinator);
            
            // Create TreeMap component
            const treeMapContainer = document.getElementById('treemap-container');
            if (treeMapContainer && coordinator.root) {
                treeMapComponent = new TreeMap({
                    target: treeMapContainer,
                    props: {
                        data: coordinator.root,
                        width: treeMapContainer.clientWidth,
                        height: treeMapContainer.clientHeight
                    }
                });
            }
            
            // Only enable UI interactions after coordinator is fully initialized
            setupUIHandlers();
        } catch (error) {
            console.error('Failed to initialize coordinator after session recall:', error);
            // Show auth container if coordinator initialization fails
            if (authContainer) {
                authContainer.classList.remove('hidden');
            }
        }
    } else {
        console.log('No valid user session found, showing login form');
        // Show auth container if no user session
        const authContainer = document.getElementById('auth-container');
        if (authContainer) {
            authContainer.classList.remove('hidden');
        }
    }
}

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

    try {
        // Initialize coordinator
        coordinator = new Coordinator();
        await coordinator.initialize();
        console.log('Coordinator initialized:', coordinator);

        // Create TreeMap component
        const treeMapContainer = document.getElementById('treemap-container');
        if (treeMapContainer && coordinator.root) {
            treeMapComponent = new TreeMap({
                target: treeMapContainer,
                props: {
                    data: coordinator.root,
                    width: treeMapContainer.clientWidth,
                    height: treeMapContainer.clientHeight
                }
            });
        }

        // Only enable UI interactions after coordinator is fully initialized
        setupUIHandlers();
    } catch (error) {
        console.error('Failed to initialize coordinator:', error);
    }
}

// Move all UI handlers into a separate function
function setupUIHandlers() {
    // Define texts array
    const addNodeTexts = ['Add Value', 'Add Goal', 'Add Dependency', 'Add Desire', 'Add Strategy'];
    let currentTextIndex = 0;

    // Menu button and drop-zone handlers
    $('.menu-button, .drop-zone').on('click', function(e) {
        if (!coordinator) {
            console.error('Coordinator not initialized yet');
            return;
        }
        console.log('Menu/drop-zone clicked');
        const formId = $(this).data('form');
        if (!formId) return; // Skip if no form ID is set
        
        // If this is the add node form, cycle text first
        if (formId === 'addNode') {
            currentTextIndex = (currentTextIndex + 1) % addNodeTexts.length;
            $('.cycle-text').text(addNodeTexts[currentTextIndex]);
            $('#addNodeForm h2').text(addNodeTexts[currentTextIndex]);
        }
        
        // Then open the form
        $('.popup-form').hide();
        $(`#${formId}Form`).show();
        $('.node-popup').addClass('active');

        if (formId === 'addNode') {
            const currentView = coordinator.currentView;
            const hasChildren = currentView?.children.size > 0;
            $('#percentageGroup').toggle(hasChildren);
        }

        if (formId === 'revealQR') {
            generateQRCode();
        }
    });

    // Form submission handler
    $('#addNodeForm').on('submit', async function(e) {
        e.preventDefault();
        if (!coordinator) {
            console.error('Coordinator not initialized yet');
            return;
        }
        console.log('Form submitted');
        const name = $('#nodeName').val() as string;
        const currentView = coordinator.currentView;
        
        if (!currentView) {
            console.error('No current view available');
            return;
        }
        
        const hasChildren = currentView.children.size > 0;
        const percentage = hasChildren ? Number($('#nodePercentage').val()) : 100;
        
        if (hasChildren && (percentage <= 0 || percentage >= 100)) {
            alert('Percentage must be between 1 and 99');
            return;
        }
        
        const currentTotal = hasChildren ? 
            Array.from(currentView.children.values()).reduce((sum, child) => sum + child.points, 0) : 
            currentView.points || 100;
            
        const points = hasChildren ? 
            Math.max(1, Math.ceil(currentTotal / (1 - percentage/100)) - currentTotal) : 
            currentTotal;
        
        await currentView.addChild(name, points);
        
        // Close and reset form
        $('.node-popup').removeClass('active');
        ($('#addNodeForm')[0] as HTMLFormElement).reset();
    });

    // Pie container click handler
    $('#pie-container').on('click', function(e) {
        console.log('Pie container clicked!');
        $('.popup-form').hide(); // Hide any other open forms
        $('#pieMenuForm').show(); // Show the pie menu
        $('.node-popup').addClass('active'); // Make popup visible
    });

    // Range input handler
    $('#nodePercentage').on('input', function() {
        $(this).next('output').text($(this).val() + '%');
    });

    // Cancel buttons
    $('.cancel').on('click', function() {
        $('.node-popup').removeClass('active');
        ($('#addNodeForm')[0] as HTMLFormElement).reset();
    });

    // Copy key handler
    $('.copy-key').on('click', function() {
        const publicKey = $('#public-key-text').text();
        navigator.clipboard.writeText(publicKey)
            .then(() => alert('Public key copied to clipboard!'));
    });

    function generateQRCode() {
        const publicKey = user.is?.pub;
        
        if (!publicKey) {
            console.log('User not logged in yet');
            return;
        }
        
        $('#qr-code').empty();
        const qrSvg = encodeQR(publicKey, 'svg', { 
            scale: 4, 
            ecc: 'high' 
        });
        $('#qr-code').append(qrSvg);
        $('#public-key-text').text(publicKey);
    }

    // Add keyboard event listener for Escape key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && treeMapComponent) {
            const currentView = treeMapComponent.getCurrentView();
            if (currentView?.parent) {
                treeMapComponent.zoomOut(currentView);
            }
        }
    });

    // QR code scanning functionality
    let videoStream: MediaStream | null = null;
    let scanInterval: number | null = null;

    // QR Tab switching functionality
    $('.tab-button').on('click', function() {
        const tabId = $(this).data('tab');
        $('.tab-button').removeClass('active');
        $(this).addClass('active');
        $('.tab-content').hide();
        $(`#${tabId}`).show();
        
        // If discover tab is clicked, automatically trigger user discovery
        if (tabId === 'discover-tab') {
            $('#discover-users-tab').trigger('click');
        }
    });

    // Start camera for QR scanning
    $('.menu-button[data-form="scanQR"]').on('click', function() {
        startQRScanner();
    });

    function startQRScanner() {
        const video = document.getElementById('qr-video') as HTMLVideoElement;
        const canvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        const scanResult = document.getElementById('scan-result');

        if (!ctx || !scanResult) return;

        // Stop any existing scanner
        stopQRScanner();

        // Request camera access
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(stream => {
                videoStream = stream;
                video.srcObject = stream;
                video.play();

                // Set canvas size to match video
                video.onloadedmetadata = () => {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                };

                // Start scanning for QR codes
                scanInterval = window.setInterval(() => {
                    if (video.readyState === video.HAVE_ENOUGH_DATA) {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        
                        try {
                            const result = decodeQR(imageData);
                            if (result) {
                                stopQRScanner();
                                scanResult.textContent = `Found: ${result}`;
                                $('#manual-key').val(result);
                            }
                        } catch (error) {
                            // No QR code found, continue scanning
                        }
                    }
                }, 500);
            })
            .catch(error => {
                console.error('Camera access error:', error);
                scanResult.textContent = 'Camera access denied or error occurred';
            });
    }

    function stopQRScanner() {
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
            videoStream = null;
        }
        
        if (scanInterval !== null) {
            window.clearInterval(scanInterval);
            scanInterval = null;
        }
    }

    // Logout button handler
    $('#logout').on('click', function() {
        // Clean up components
        if (treeMapComponent) {
            treeMapComponent.$destroy();
            treeMapComponent = undefined;
        }
        
        if (coordinator) {
            coordinator.destroy();
            coordinator = undefined;
        }
        
        logout();
        location.reload(); // Refresh the page to show login screen
    });
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
});

// Add this to your existing script section
const messageInput = document.getElementById('message-input');
if (messageInput) {
    messageInput.addEventListener('input', function(e) {
        // Reset height to auto to get the right scrollHeight
        this.style.height = 'auto';
        // Set new height based on content
        this.style.height = (this.scrollHeight) + 'px';
    });
}

