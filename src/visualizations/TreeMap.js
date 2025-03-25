import * as d3 from 'd3';
import { getColorForName } from '../utils/colorUtils.js';
import { calculateFontSize } from '../utils/fontUtils.js';

export function createTreemap(data, width, height) {
    // State variables for growth animation
    let growthInterval = null;
    let growthTimeout = null;
    const GROWTH_RATE = (d) => d.data.points * 0.05;
    const GROWTH_TICK = 50;
    const GROWTH_DELAY = 500;
    let isGrowing = false;
    const SHRINK_RATE = (d) => d.data.points * -0.05; // Negative growth rate for shrinking

    // Helper functions
    const uid = (function() {
        let id = 0;
        return function(prefix) {
            const uniqueId = `${prefix}-${++id}`;
            return { id: uniqueId, href: `#${uniqueId}` };
        };
    })();

    const name = d => d.data.ancestors().reverse().map(d => d.name).join(" / ");

    // Create scales
    const x = d3.scaleLinear().rangeRound([0, width]);
    const y = d3.scaleLinear().rangeRound([0, height]);

    // Create hierarchy
    let hierarchy = d3.hierarchy(data, d => d.childrenArray)
        .sum(d => d.data.points)
        .each(d => { d.value = d.data.points || 0; });

    // Create treemap layout
    let root = d3.treemap().tile(tile)(hierarchy);
    let currentView = root;

    // Set initial domains
    x.domain([root.x0, root.x1]);
    y.domain([root.y0, root.y1]);

    // Create SVG
    const svg = d3.create("svg")
        .attr("viewBox", [0.5, -50.5, width, height + 50])
        .style("font", "10px sans-serif");

    // Prevent context menu (right-click menu) to allow for right-click interactions
    svg.on("contextmenu", event => {
        event.preventDefault();
    });

    // Create initial group
    let group = svg.append("g")
        .call(render, root);

    // Helper to darken a color for the fulfillment indicator
    function darkenColor(color, factor = 0.3) {
        const rgb = d3.rgb(color);
        return d3.rgb(
            Math.max(0, rgb.r - rgb.r * factor),
            Math.max(0, rgb.g - rgb.g * factor),
            Math.max(0, rgb.b - rgb.b * factor),
            0.35  // Add 35% opacity to allow text to be visible
        );
    }

    function tile(node, x0, y0, x1, y1) {
        if (!node.children) return;
        
        // Calculate available space
        const availableWidth = x1 - x0;
        const availableHeight = y1 - y0;
        
        // Ensure values match points
        node.children.forEach(child => {
            child.value = child.data.points || 0;
        });
        
        // Create a simpler hierarchy object that matches d3's expectations
        const tempRoot = {
            children: node.children.map(child => ({
                data: child.data,
                value: child.value
            }))
        };
        
        // Create hierarchy and apply squarify directly
        const tempHierarchy = d3.hierarchy(tempRoot)
            .sum(d => d.value)
            
        // Apply squarify directly with the available space
        d3.treemapSquarify(tempHierarchy, 0, 0, availableWidth, availableHeight);
        
        // Debug total values
        // console.log('Total hierarchy value:', tempHierarchy.value);
        // console.log('Available space:', [availableWidth, availableHeight]);
        
        // Transfer positions back to our nodes
        node.children.forEach((child, i) => {
            if (tempHierarchy.children && tempHierarchy.children[i]) {
                const tempNode = tempHierarchy.children[i];
                child.x0 = x0 + tempNode.x0;
                child.x1 = x0 + tempNode.x1;
                child.y0 = y0 + tempNode.y0;
                child.y1 = y0 + tempNode.y1;
                
                // Debug
                // console.log(`${child.data.name}: value=${child.value}, width=${child.x1 - child.x0}, height=${child.y1 - child.y0}`);
            }
        });
    }
  
    function position(group, root) {
        // Position elements with a single selector
        group.selectAll("g:not(.home-button)")
            .attr("transform", d => {
                if (!d || typeof d.x0 === 'undefined') return '';
                return d === root ? `translate(0,-50)` : `translate(${x(d.x0)},${y(d.y0)})`;
            })
            .each(function(d) {
                if (!d || typeof d.x0 === 'undefined') return;
                
                const nodeGroup = d3.select(this);
                const nodeWidth = d === root ? width : x(d.x1) - x(d.x0);
                const nodeHeight = d === root ? 50 : y(d.y1) - y(d.y0);
                
                // Update node rectangle
                nodeGroup.select("rect.node-rect")
                    .attr("width", nodeWidth)
                    .attr("height", nodeHeight);
                
                // Update fulfillment indicator if not root
                if (d !== root) {
                    const fulfillmentPercentage = d.data.fulfilled;
                    const indicatorWidth = nodeWidth * fulfillmentPercentage;
                    
                    nodeGroup.select("rect.fulfillment-indicator")
                        .attr("width", indicatorWidth)
                        .attr("height", nodeHeight);
                    
                    // Update handle position if it exists
                    nodeGroup.select("rect.fulfillment-handle")
                    .attr("x", indicatorWidth - 4)
                        .attr("y", nodeHeight * 0.75 - 10)
                    .attr("height", 20);
                }
                
                // Update text position
                nodeGroup.select("text:not(.indicator):not(.points):not(.back-indicator)")
                    .attr("transform", `translate(${nodeWidth / 2},${nodeHeight / 2})`)
                    .style("font-size", calculateFontSize(d, nodeWidth, nodeHeight, root, x, y, currentView) + "px");
                
                // Update type indicators
                nodeGroup.select(".type-indicators")
                    .attr("transform", `translate(${nodeWidth - 10}, 10)`);
            });
    }
  
    function zoomin(d) {
        // Prevent zooming if already transitioning
        if (svg.classed("transitioning")) return;
        svg.classed("transitioning", true);
        
        console.log('Zooming in to:', d.data.name);
        
        // Clear any animation timers
        if (growthInterval) clearInterval(growthInterval);
        if (growthTimeout) clearTimeout(growthTimeout);
        growthInterval = null;
        isGrowing = false;
        
        // Interrupt any existing transitions
        svg.selectAll("*").interrupt();
        
        // Update state
        currentView = d;
        
        // Update domains
        x.domain([d.x0, d.x1]);
        y.domain([d.y0, d.y1]);
        
        // Create new group
        const newGroup = svg.append("g");
        
        // Set up transition for old group
        const oldGroup = group;
        oldGroup
            .attr("pointer-events", "none")
            .transition()
            .duration(750)
            .style("opacity", 0)
            .remove();
        
        // Render new view
        group = newGroup;
        render(newGroup, d);
        
        // Apply position immediately then fade in
        position(newGroup, d);
        newGroup
            .style("opacity", 0)
            .transition()
            .duration(750)
            .style("opacity", 1)
            .on("end", () => {
                svg.classed("transitioning", false);
            });
    }
  
    function zoomout(d) {
        // Prevent zooming if already transitioning or no parent
        if (svg.classed("transitioning") || !d.parent) return;
        svg.classed("transitioning", true);
        
        console.log('Zooming out from:', d.data.name);
        
        // Clear any animation timers
        if (growthInterval) clearInterval(growthInterval);
        if (growthTimeout) clearTimeout(growthTimeout);
        growthInterval = null;
        isGrowing = false;
        
        // Interrupt any existing transitions
        svg.selectAll("*").interrupt();
        
        // Update state
        currentView = d.parent;
        
        // Update domains
        x.domain([d.parent.x0, d.parent.x1]);
        y.domain([d.parent.y0, d.parent.y1]);
        
        // Create new group
        const newGroup = svg.append("g");
        
        // Set up transition for old group
        const oldGroup = group;
        oldGroup
            .attr("pointer-events", "none")
            .transition()
            .duration(750)
            .style("opacity", 0)
            .remove();
        
        // Render new view
        group = newGroup;
        render(newGroup, d.parent);
        
        // Apply position immediately then fade in
        position(newGroup, d.parent);
        newGroup
            .style("opacity", 0)
            .transition()
            .duration(750)
            .style("opacity", 1)
            .on("end", () => {
                svg.classed("transitioning", false);
            });
    }

    // Consolidated mouse/touch event handling
    function setupNodeInteractions(node) {
        node
            .on("mousedown touchstart", (event, d) => {
                // Skip if transitioning or root node
                if (svg.classed("transitioning") || d === root) return;
                
                event.preventDefault();
                
                // Set touch state
                isTouching = true;
                touchStartTime = Date.now();
                activeNode = d;
                
                // Only set up growth if not in contributor tree
                if (!isInContributorTree()) {
                    // Clear existing timers
                    if (growthInterval) clearInterval(growthInterval);
                    if (growthTimeout) clearTimeout(growthTimeout);
                    isGrowing = false;
                    
                    // Determine if growing or shrinking
                    const isShrinking = (event.type === 'mousedown' && event.button === 2) || 
                                       (event.type === 'touchstart' && event.touches.length === 2);
                    
                    // Set delayed growth
                    growthTimeout = setTimeout(() => {
                        if (!isTouching || activeNode !== d) return;
                        
                        console.log(`Starting ${isShrinking ? 'shrink' : 'growth'} for ${d.data.name}`);
                        isGrowing = true;
                        
                        // Start growth interval
                        growthInterval = setInterval(() => {
                            if (!isTouching) {
                                clearInterval(growthInterval);
                                growthInterval = null;
                                isGrowing = false;
                                return;
                            }
                            
                            // Calculate new points
                            const rate = isShrinking ? SHRINK_RATE(d) : GROWTH_RATE(d);
                            const oldPoints = d.data.points;
                            const newPoints = Math.max(0, oldPoints + rate);
                            d.data.setPoints(newPoints);
                            
                            // Update layout
                            updateDataAndLayout();
                        }, GROWTH_TICK);
                    }, GROWTH_DELAY);
                }
            })
            .on("mouseup touchend touchcancel", (event) => {
                if (!isInContributorTree()) {
                    event.preventDefault();
                    isTouching = false;
                    activeNode = null;
                    
                    // Clear timers
                    if (growthTimeout) clearTimeout(growthTimeout);
                    if (growthInterval) clearInterval(growthInterval);
                    growthInterval = null;
                    isGrowing = false;
                }
            })
            .on("click touchend", (event, d) => {
                // Skip if transitioning
                if (svg.classed("transitioning")) {
                    event.preventDefault();
                    return;
                }
                
                // Handle navigation click
                event.preventDefault();
                
                // Skip if we're in growth mode
                if (isGrowing) return;
                
                // Skip if drag in progress
                if (isDragging) return;
                
                console.log('Navigation click on:', d.data.name);
                
                // Handle zoom navigation
                if (d === root && d.parent) {
                    zoomout(root);
                } else if (d !== root) {
                    zoomin(d);
                }
                
                // Clear states
                isTouching = false;
                activeNode = null;
                isGrowing = false;
            });
            
        return node;
    }
    
    // Function to update layout after data changes
    function updateDataAndLayout() {
        // Recompute hierarchy
        hierarchy.sum(node => node.data.points)
            .each(node => {
                node.value = node.data.points || 0;
            });
        
        // Apply treemap
        const treemap = d3.treemap().tile(tile);
        treemap(hierarchy);
        
        // Update positions with a single transition
        const nodes = group.selectAll("g").filter(d => d !== root);
        
        nodes.transition()
            .duration(GROWTH_TICK)
            .attr("transform", d => `translate(${x(d.x0)},${y(d.y0)})`)
            .each(function(d) {
                const nodeGroup = d3.select(this);
                const nodeWidth = x(d.x1) - x(d.x0);
                const nodeHeight = y(d.y1) - y(d.y0);
                
                // Update rectangles
                nodeGroup.select("rect.node-rect")
                    .attr("width", nodeWidth)
                    .attr("height", nodeHeight);
                
                // Update fulfillment indicator
                nodeGroup.select("rect.fulfillment-indicator")
                    .attr("width", nodeWidth * d.data.fulfilled)
                    .attr("height", nodeHeight);
                
                // Update handle
                nodeGroup.select("rect.fulfillment-handle")
                    .attr("x", nodeWidth * d.data.fulfilled - 4)
                    .attr("y", nodeHeight * 0.75 - 10);
                
                // Update text
                nodeGroup.select("text:not(.indicator):not(.points)")
                    .attr("transform", `translate(${nodeWidth / 2},${nodeHeight / 2})`)
                    .style("font-size", calculateFontSize(d, nodeWidth, nodeHeight, root, x, y, currentView) + "px");
                
                // Update type indicators
                nodeGroup.select(".type-indicators")
                    .attr("transform", `translate(${nodeWidth - 10}, 10)`);
            });
    }
    
    // Add class for tracking transition state
    svg.classed("transitioning", false);
    
    // Flag for tracking drag operations
    let isDragging = false;

    // Modified render function
    function render(group, root) {
        // Create node selection with data binding
      let nodeData;
      
      if (root.children && Array.isArray(root.children)) {
          nodeData = root.children.concat(root);
      } else if (root.children && typeof root.children.values === 'function') {
          nodeData = Array.from(root.children.values()).concat(root);
      } else if (root.childrenArray) {
          nodeData = root.childrenArray.concat(root);
      } else {
          nodeData = [root];
      }

      const node = group
          .selectAll("g")
          .data(nodeData)
          .join("g")
          .filter(d => d === root || d.value > 0)
            .attr("cursor", "pointer");
            
        // Add node rectangles
        node.append("rect")
            .attr("id", d => (d.leafUid = uid("leaf")).id)
            .attr("class", "node-rect")
            .attr("fill", d => {
                if (d === root) return "#f8f9fa";
                return getColorForName(d.data.name);
            })
            .attr("stroke", d => {
                if (d === root && d.parent) return "#007bff";
                return (d.data.hasDirectContributionChild) ? "#2196f3" : "#fff";
            })
            .attr("stroke-width", d => {
                if (d === root && d.parent) return "3";
                return (d.data.hasDirectContributionChild) ? "2" : "2";
            });

        // Add tooltips
        node.append("title")
            .text(d => {
                const fulfillmentText = d === root ? "" : 
                    `\nFulfillment: ${Math.round(d.data.fulfilled * 100)}%`;
                return `${name(d)}${fulfillmentText}`;
            });
            
        // Add fulfillment indicators (only for non-root nodes)
        node.filter(d => d !== root)
            .append("rect")
            .attr("class", "fulfillment-indicator")
            .attr("fill", d => {
                const baseColor = getColorForName(d.data.name);
                return darkenColor(baseColor);
            });
            
        // Add handles (only for nodes with direct contribution children)
        node.filter(d => {
            return d !== root && d.data.children.size > 0 && d.data.hasDirectContributionChild;
        })
        .each(function(d) {
            const nodeGroup = d3.select(this);
            
            // Add drag handle
            const handle = nodeGroup.append("rect")
                .attr("class", "fulfillment-handle")
                .attr("width", 8)
                .attr("fill", "rgba(255, 255, 255, 0.7)")
                .attr("stroke", "#fff")
                .attr("stroke-width", 2)
                .attr("cursor", "ew-resize")
                .attr("rx", 4);
                
            // Set up drag behavior with simplified handlers
            const dragBehavior = d3.drag()
                .on("start", function(event) {
                    isDragging = true;
                })
                .on("drag", function(event) {
                    const rectWidth = x(d.x1) - x(d.x0);
                    const newWidth = Math.max(0, Math.min(rectWidth, event.x));
                    const fulfillmentValue = newWidth / rectWidth;
                    
                    // Update UI
                    nodeGroup.select("rect.fulfillment-indicator")
                        .attr("width", newWidth);
                    
                    nodeGroup.select("rect.fulfillment-handle")
                        .attr("x", newWidth - 4);
                    
                    // Update data
                    d.data.fulfillment = fulfillmentValue;
                    
                    // Update tooltip
                    nodeGroup.select("title")
                        .text(`${name(d)}\nFulfillment: ${Math.round(fulfillmentValue * 100)}%`);
                })
                .on("end", function(event) {
                    event.sourceEvent.stopPropagation();
                    
                    // Clear timers
                    if (growthInterval) {
                        clearInterval(growthInterval);
                        growthInterval = null;
                    }
                    isGrowing = false;
                    
                    const rectWidth = x(d.x1) - x(d.x0);
                    const currentWidth = parseFloat(nodeGroup.select("rect.fulfillment-indicator").attr("width"));
                    const finalFulfillmentValue = currentWidth / rectWidth;
                    
                    // Update data
                    d.data.fulfillment = finalFulfillmentValue;
                    
                    // Reset drag state after a short delay
                    setTimeout(() => {
                        isDragging = false;
                    }, 50);
                });
                
            // Add drag behavior to both indicator and handle
            nodeGroup.select("rect.fulfillment-indicator").call(dragBehavior);
            handle.call(dragBehavior);
        });
        
        // Add text
        node.append("clipPath")
            .attr("id", d => (d.clipUid = uid("clip")).id)
            .append("use")
            .attr("xlink:href", d => d.leafUid.href);

        node.append("text")
            .attr("clip-path", d => d.clipUid)
            .attr("font-weight", d => d === root ? "bold" : null)
            .style("user-select", "none")
            .style("-webkit-user-select", "none")
            .style("-moz-user-select", "none")
            .style("-ms-user-select", "none")
            .selectAll("tspan")
            .data(d => {
                if (d === root) return [name(d)];
                return d.data.name.split(/(?=[A-Z][^A-Z])/g);
            })
            .join("tspan")
            .attr("x", 0)
            .attr("dy", (d, i, nodes) => {
                if (i === 0) {
                    return `${-(nodes.length - 1) * 1.2 / 2}em`;
                }
                return "1.2em";
            })
            .text(d => d)
            .style("text-anchor", "middle");
  
        // Add type indicators
        node.append("g")
        .attr("class", "type-indicators")
            .each(function(d) {
        if (!d.data.types) return;
        
        const container = d3.select(this);
        const circleRadius = 8;
        const spacing = circleRadius * 2.5;
        
                container.selectAll("circle")
            .data(d.data.types)
            .join("circle")
            .attr("cx", (_, i) => -i * spacing)
            .attr("cy", 0)
            .attr("r", circleRadius)
            .attr("fill", type => getColorForName(type.name))
            .attr("stroke", "#fff")
            .attr("stroke-width", "2")
            .attr("cursor", "pointer")
                    .style("pointer-events", "all")
                    .on("click", function(event, type) {
            event.stopPropagation();
                        
                        // Skip if transitioning
                        if (svg.classed("transitioning")) return;
            
            console.log('Loading tree for type:', type.name);
            
                        // Create new hierarchy using the type
            hierarchy = d3.hierarchy(type, d => d.childrenArray)
                .sum(d => d.points)
                .each(node => {
                    node.value = node.data.points || 0;
                });
            
                        // Apply treemap
            const treemap = d3.treemap().tile(tile);
            root = treemap(hierarchy);
                        currentView = root;
            
            // Reset domains
            x.domain([root.x0, root.x1]);
            y.domain([root.y0, root.y1]);
            
                        // Replace group with new content
                        const oldGroup = group;
                        group = svg.append("g");
            render(group, root);
                        oldGroup.remove();
                    })
                    .append("title")
            .text(type => `Click to view ${type.name}'s tree`);
    });

        // Add back indicator for root nodes with parent
        node.filter(d => d === root && d.parent)
            .append("text")
            .attr("class", "back-indicator")
            .attr("x", 15)
            .attr("y", 25)
            .attr("text-anchor", "start")
            .attr("dominant-baseline", "middle")
            .attr("font-size", "18px")
            .attr("fill", "#007bff")
            .text("← Back")
            .on("click", (event) => {
                // Skip if transitioning
                if (svg.classed("transitioning")) return;
                
                event.stopPropagation();
                console.log("Back button clicked, zooming out");
                zoomout(root);
            })
            .attr("margin-right", "15px");
            
        // Add home button if in contributor tree
        node.filter(d => d === root)
                                    .each(function(d) {
                let isContributorTree = true;
                let temp = d;
                
                while (temp) {
                    if (temp.data === data) {
                        isContributorTree = false;
                        break;
                    }
                    temp = temp.parent;
                }

                if (isContributorTree) {
                    d3.select(this)
                        .append("g")
                        .attr("class", "home-button")
                        .attr("transform", "translate(20, 25)")
                        .style("cursor", "pointer")
                        .on("click", (event) => {
                            // Skip if transitioning
                            if (svg.classed("transitioning")) return;
                            
                            event.stopPropagation();
                            console.log("Home button clicked, returning to root");
                            
                            // Reset to original data
                            hierarchy = d3.hierarchy(data, d => d.childrenArray)
                                .sum(d => d.data.points)
                                .each(d => { d.value = d.data.points || 0; });
                            
                            // Apply treemap
                            const treemap = d3.treemap().tile(tile);
                            root = treemap(hierarchy);
                            currentView = root;
                            
                            // Reset domains
                            x.domain([root.x0, root.x1]);
                            y.domain([root.y0, root.y1]);
                            
                            // Replace group
                            const oldGroup = group;
                            group = svg.append("g");
                            render(group, root);
                            oldGroup.remove();
                        })
                        .append("text")
                        .attr("fill", "#000")
                        .attr("font-size", "20px")
                        .attr("dominant-baseline", "middle")
                        .text("🏠");
                }
            });
            
        // Add empty view helper text if needed
        if (root.data.children.size === 0 && root !== data) {
            group.append("text")
                .attr("class", "helper-text")
                .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
                .attr("x", width / 2)
                .attr("y", height / 2)
                .style("font-size", "24px")
                .style("fill", "#666")
                .style("pointer-events", "none")
                .style("user-select", "none")
                .text("Add Values / Contributors");
        }
        
        // Set up event handlers
        setupNodeInteractions(node);
        
        // Initial positioning
        position(group, root);
        
        return group;
    }

    // Add touch state tracking at the top
    let touchStartTime = 0;
    let isTouching = false;
    let activeNode = null; // Track which node we're growing

    // Add function to check if we're in a contributor tree
    function isInContributorTree() {
        let temp = currentView;
        while (temp) {
            if (temp.data === data) {
                return false;
            }
            temp = temp.parent;
        }
        return true;
    }

    // Return modified public interface
    return {
        getCurrentView: () => currentView,
        getCurrentData: () => data,
        element: svg.node(),
        getRoot: () => root,
        zoomin,
        zoomout,
        update: (newWidth, newHeight) => {
            console.log('Update called with dimensions:', newWidth, height);
            
            // Skip if currently transitioning
            if (svg.classed("transitioning")) return;
            
            // Interrupt any existing transitions
            svg.selectAll("*").interrupt();
            
            // Update scales
            x.rangeRound([0, newWidth]);
            y.rangeRound([0, newHeight]);
            
            // Update SVG viewBox
            svg.attr("viewBox", [0.5, -50.5, newWidth, newHeight + 50]);
            
            // Replace group
            group.remove();
            group = svg.append("g");
            render(group, currentView);
        },
        highlightNodes: (matchedNodes) => {
            // Skip if currently transitioning
            if (svg.classed("transitioning")) return;
            
            // Interrupt any existing transitions
            svg.selectAll("*").interrupt();
            
            // Clear highlights
            svg.selectAll('rect').classed('search-highlight', false);
            
            // Add highlights to matches
            svg.selectAll('rect.node-rect')
                .filter(d => matchedNodes.some(node => node.name === d.data.name))
                .classed('search-highlight', true);
            
            // Zoom to first match if any
            if (matchedNodes.length > 0) {
                const firstMatch = matchedNodes[0];
                
                const findNode = (node) => {
                    if (node.data.name === firstMatch.name) return node;
                    if (node.children) {
                        for (const child of node.children) {
                            const found = findNode(child);
                            if (found) return found;
                        }
                    }
                    return null;
                };
                
                const matchedNode = findNode(root);
                
                if (matchedNode && matchedNode !== currentView) {
                        zoomin(matchedNode);
                }
            }
        },
        clearHighlights: () => {
            svg.selectAll('rect').classed('search-highlight', false);
        }
    };
}

// Export the update function to allow external updates
export function updateTreemap(root) {
    // Re-render the treemap
    const container = document.getElementById('treemap-container');
    
    // Clear the container
    container.innerHTML = '';
    
    // Create a new treemap
    const treemap = createTreemap(root.data, container.clientWidth, container.clientHeight);
    
    // Append the new treemap to the container
    container.appendChild(treemap);
}
