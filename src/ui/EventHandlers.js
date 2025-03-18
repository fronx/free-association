import { TreeMap } from '../visualizations/TreeMap.js';
import { createPieChart } from '../visualizations/PieChart.js';
import { addNodeTexts } from './Forms.js';
import { updateTreemap } from '../visualizations/TreeMap.js';

export function setupEventHandlers(currentView, root) {
    let currentTextIndex = 0;

    // Menu button handlers
    $('.menu-button').on('click', function() {
        const formId = $(this).data('form');
        $('.popup-form').hide();
        $(`#${formId}Form`).show();
        $('.node-popup').addClass('active');

        if (formId === 'addNode') {
            const hasChildren = currentView.data.children.size > 0;
            $('#percentageGroup').toggle(hasChildren);
        }

        if (formId === 'revealQR') {
            generateQRCode();
        }
    });

    // Cycle text button
    $('.cycle-text').on('click', function() {
        currentTextIndex = (currentTextIndex + 1) % addNodeTexts.length;
        $(this).text(addNodeTexts[currentTextIndex]);
        $('#addNodeForm h2').text(addNodeTexts[currentTextIndex]);
    });

    // Range input handler
    $('#nodePercentage').on('input', function() {
        $(this).next('output').text($(this).val() + '%');
    });

    // Fulfillment slider handler
    $('#fulfillmentSlider').on('input', function() {
        $(this).next('output').text($(this).val() + '%');
    });

    // Copy key handler
    $('.copy-key').on('click', function() {
        const publicKey = $('#public-key-text').text();
        navigator.clipboard.writeText(publicKey)
            .then(() => alert('Public key copied to clipboard!'));
    });

    // Cancel buttons
    $('.cancel').on('click', function() {
        $('.node-popup').removeClass('active');
        $('#addNodeForm')[0].reset();
    });

    // Form submission
    $('#addNodeForm').on('submit', function(e) {
        e.preventDefault();
        handleFormSubmission($(this), currentView, root);
    });

    // Fulfillment form submission
    $('#setFulfillmentForm').on('submit', function(e) {
        e.preventDefault();
        
        // Get the fulfillment value from the slider
        const fulfillmentValue = $('#fulfillmentSlider').val() / 100;
        
        // Set the fulfillment value on the node
        if (window.selectedNodeForFulfillment) {
            window.selectedNodeForFulfillment.fulfillment = fulfillmentValue;
            
            // Close the form
            $('.node-popup').removeClass('active');
            
            // Update the visualization
            updateTreemap(root);
        }
    });
}

function generateQRCode() {
    const mockPublicKey = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    $('#qr-code').empty();
    
    new QRCode(document.getElementById("qr-code"), {
        text: mockPublicKey,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H,
        useSVG: true
    });
    
    $('#public-key-text').text(mockPublicKey);
}

function handleFormSubmission($form, currentView, root) {
    const name = $('#nodeName').val();
    const hasChildren = currentView.data.children.size > 0;
    const percentage = hasChildren ? Number($('#nodePercentage').val()) : 100;
    
    if (hasChildren && (percentage <= 0 || percentage >= 100)) {
        alert('Percentage must be between 1 and 99');
        return;
    }
    
    const currentTotal = currentView.data.totalChildPoints || currentView.data.points || 100;
    const points = hasChildren ? 
        Math.max(1, Math.ceil(currentTotal / (1 - percentage/100)) - currentTotal) : 
        currentTotal;
    
    const newChild = currentView.data.addChild(name, points);
    
    // Recompute visualizations
    updateVisualizations(root, currentView);
    
    // Close and reset form
    $('.node-popup').removeClass('active');
    $form[0].reset();
}

function updateVisualizations(root, currentView) {
    const $container = $('#treemap-container');
    const path = [];
    let temp = currentView;
    
    while (temp !== root) {
        path.push(temp);
        temp = temp.parent;
    }
    
    $container.empty();
    $container.append(TreeMap(root.data));
    
    $('#pie-container').empty()
        .append(createPieChart(root.data));
    
    path.reverse().forEach(node => zoomin(node));
} 