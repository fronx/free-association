import { initializeExampleData } from './example';
import { App } from './App';
import * as GunX from './models/Gun';
import './style.css';
import $ from 'jquery';
import encodeQR from '@paulmillr/qr';
import decodeQR from '@paulmillr/qr/decode.js';
import { Bitmap } from '@paulmillr/qr';

let app: App | undefined;

async function handleAuth(event: Event) {
    event.preventDefault();
    console.log('Auth handler started');
    const username = (document.getElementById('username') as HTMLInputElement).value;
    const password = (document.getElementById('password') as HTMLInputElement).value;

    try {
        await GunX.authenticate(username, password);
        console.log('Login successful');
    } catch(error) {
        console.log('Auth failed:', error);
    }

    const authContainer = document.getElementById('auth-container');
    if (!authContainer) {
        console.error('Auth container not found');
        return;
    }
    authContainer.classList.add('hidden');
    console.log('Auth container hidden');

    try {
        // Initialize app with proper await
        app = new App();
        await app.initialize();  // Wait for initialization
        console.log('App initialized:', app);

        // Only enable UI interactions after app is fully initialized
        setupUIHandlers();
    } catch (error) {
        console.error('Failed to initialize app:', error);
    }
}

// Move all UI handlers into a separate function
function setupUIHandlers() {
    // Define texts array
    const addNodeTexts = ['Add Value', 'Add Goal', 'Add Dependency', 'Add Desire', 'Add Strategy'];
    let currentTextIndex = 0;

    // Menu button and drop-zone handlers
    $('.menu-button, .drop-zone').on('click', function(e) {
        if (!app) {
            console.error('App not initialized yet');
            return;
        }
        console.log('Menu/drop-zone clicked');
        console.log('app exists:', app);
        console.log('app treemap exists:', (app?.treemap));
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
            const hasChildren = app?.currentView?.hasChildren;
            console.log('currentViewData:', app?.currentView.data);  // Debug log
            console.log('currentView:', app?.currentView.data.name);  // Debug log
        
            $('#percentageGroup').toggle(hasChildren);
        }

        if (formId === 'revealQR') {
            generateQRCode();
        }
    });

    // Form submission handler
    $('#addNodeForm').on('submit', async function(e) {
        e.preventDefault();
        if (!app) {
            console.error('App not initialized yet');
            return;
        }
        console.log('Form submitted');
        console.log('app exists:', app);
        console.log('app treemap exists:', (app?.treemap));
        const name = $('#nodeName').val();
        const currentViewData = app?.currentView.data;
        
        const hasChildren = currentViewData.hasChildren;
        const percentage = hasChildren ? Number($('#nodePercentage').val()) : 100;
        
        if (hasChildren && (percentage <= 0 || percentage >= 100)) {
            alert('Percentage must be between 1 and 99');
            return;
        }
        
        const currentTotal = currentViewData.totalChildPoints || currentViewData.points || 100;
        const points = hasChildren ? 
            Math.max(1, Math.ceil(currentTotal / (1 - percentage/100)) - currentTotal) : 
            currentTotal;
        
        console.log('Adding node to:', currentViewData.name);  // Debug log
        currentViewData.addChild(name, points);
        
        // Update visualizations
        await app?.updateVisualizations();
        
        // Close and reset form
        $('.node-popup').removeClass('active');
        ($('#addNodeForm')[0] as HTMLFormElement).reset();
    });

    // Pie container click handler - moved out of DOMContentLoaded
    $('#pie-container').on('click', function(e) {
        console.log('Pie container clicked!'); // Debug log
        if (!app) {
            console.error('App not initialized yet');
            return;
        }
        $('.popup-form').hide(); // Hide any other open forms
        $('#pieMenuForm').show(); // Show the pie menu
        $('.node-popup').addClass('active'); // Make popup visible
    });

    // Menu button handlers - moved out of DOMContentLoaded
    $('.menu-button').on('click', function(e) {
        const formId = $(this).data('form');
        if (!formId) return;
        
        console.log('Menu button clicked:', formId); // Debug log
        $('#pieMenuForm').hide();
        $(`#${formId}Form`).show();
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
        // Use the existing 'player' Gun reciever instance
        const publicKey = GunX.user.is?.pub;  // Add optional chaining for safety
        
        if (!publicKey) {
            console.log('Reciever not logged in yet');
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
        if (event.key === 'Escape') {
            const treemap = app?.treemap;  // Get treemap instance from app
            if (treemap) {
                const currentView = treemap.getCurrentView();  // Use treemap's method to get current view
                
                if (currentView && currentView.parent) {
                    treemap.zoomout(currentView);  // Use treemap's zoomout method directly
                }
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
                            // No QR code found yet, continue scanning
                        }
                    }
                }, 200);
            })
            .catch(error => {
                console.error('Error accessing camera:', error);
                scanResult.textContent = 'Error: Could not access camera. Please enter the key manually.';
            });
    }

    function stopQRScanner() {
        if (scanInterval) {
            clearInterval(scanInterval);
            scanInterval = null;
        }
        
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
            videoStream = null;
        }
    }

    // Handle connecting to peer
    $('#connect-peer').on('click', async function() {
        const manualKey = $('#manual-key').val() as string;
        if (manualKey) {
            // Replace the TODO with actual connection logic
            console.log('Connecting to peer with key:', manualKey);
            
            if (!app) {
                alert('App not initialized yet');
                return;
            }
            
            const success = await app.connectToPeer(manualKey);
            
            if (success) {
                alert(`Connected to peer with key: ${manualKey}`);
                // You might want to add the peer to a list in the UI
            } else {
                alert(`Failed to connect to peer with key: ${manualKey}`);
            }
            
            $('.node-popup').removeClass('active');
        } else {
            alert('Please scan a QR code or enter a public key');
        }
    });

    // Add discover users functionality
    $('.discover-users').on('click', async function() {
        if (!app) {
            alert('App not initialized yet');
            return;
        }

        // Show loading state
        $('#user-list').html('<li>Searching for users...</li>');
        
        try {
            const users = await app.discoverUsers();
            
            if (users.length === 0) {
                $('#user-list').html('<li>No users found</li>');
                return;
            }
            
            // Format and display the list of users
            const listHtml = users.map(user => {
                const lastSeenDate = user.lastSeen ? new Date(user.lastSeen).toLocaleString() : 'Unknown';
                return `
                    <li>
                        <div>${user.name}</div>
                        <div>Last seen: ${lastSeenDate}</div>
                        <button class="connect-to-user" data-id="${user.id}">Connect</button>
                    </li>
                `;
            }).join('');
            
            $('#user-list').html(listHtml);
            
            // Add click handlers for the connect buttons
            $('.connect-to-user').on('click', async function() {
                const userId = $(this).data('id');
                const success = await app.connectToPeer(userId);
                
                if (success) {
                    alert(`Connected to ${$(this).parent().find('div').first().text()}`);
                    $('.node-popup').removeClass('active');
                } else {
                    alert('Failed to connect to user');
                }
            });
            
        } catch (error) {
            console.error('Error discovering users:', error);
            $('#user-list').html('<li>Error discovering users</li>');
        }
    });

    // Stop scanner when form is closed
    $('#scanQRForm .cancel').on('click', function() {
        stopQRScanner();
    });

    // Add tab button in main.ts
    $('.tab-button[data-tab="discover-tab"]').on('click', function() {
        $('.discover-users').trigger('click');
    });
}

// Initial setup for already logged in users
if (!GunX.user.is) {
    const authContainer = document.getElementById('auth-container');
    const authForm = document.getElementById('auth-form');
    if (authContainer && authForm) {
        authContainer.classList.remove('hidden');
        authForm.addEventListener('submit', handleAuth);
    }
} else {
    const authContainer = document.getElementById('auth-container');
    if (authContainer) {
        authContainer.classList.add('hidden');
    }
    // Handle already logged in case
    (async () => {
        try {
            if (app?.root) {
                await initializeExampleData(app.root);
                console.log('App initialized for logged in user:', app);
                setupUIHandlers();
            }
        } catch (error) {
            console.error('Failed to initialize app for logged in user:', error);
        }
    })();
}

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

