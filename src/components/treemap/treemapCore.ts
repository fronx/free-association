import * as d3 from 'd3';
import type { TreeNode } from '../../models/TreeNode';
import type { TreeNode as ReactTreeNode } from '../../models/ReactTreeNode';
import type { TreemapInstance, TreemapNode } from './types';

// Type for a node that could be either TreeNode or ReactTreeNode
type AnyTreeNode = TreeNode | ReactTreeNode;

/**
 * Create a treemap instance with the given data and dimensions
 */
export function createTreemap(data: AnyTreeNode, width: number, height: number): TreemapInstance {
    console.log('[treemapCore] createTreemap - Input data:', data);
    console.log('[treemapCore] createTreemap - Dimensions:', { width, height });
    console.log('[treemapCore] createTreemap - Children:', Array.from((data.children as any).values()));
    
    // Create scales
    const x = d3.scaleLinear().rangeRound([0, width]);
    const y = d3.scaleLinear().rangeRound([0, height]);

    // Create hierarchy with a more generic approach to handle both TreeNode types
    let hierarchy = d3.hierarchy<AnyTreeNode>(data, d => {
        console.log('[treemapCore] hierarchy - Processing node:', d.name);
        // Cast to any to work around TypeScript limitations with Map iterators
        const childrenArray = Array.from((d.children as any).values()) as AnyTreeNode[];
        console.log('[treemapCore] hierarchy - Node children:', childrenArray.map(c => ({ name: c.name, points: c.points })));
        return childrenArray;
    })
    .sum(d => {
        console.log('[treemapCore] hierarchy.sum - Node:', d.name, 'Points:', d.points);
        return d.points;
    })
    .each(d => { 
        (d as any).value = d.data.points || 0; 
        console.log('[treemapCore] hierarchy.each - Setting value for node:', d.data.name, 'Value:', (d as any).value);
    });

    console.log('[treemapCore] createTreemap - Hierarchy created:', hierarchy);

    // Create treemap layout with custom tile function
    let root = d3.treemap().tile(tile)(hierarchy) as TreemapNode;
    let currentView = root;

    console.log('[treemapCore] createTreemap - Root created:', { 
        name: root.data.name, 
        children: root.children ? root.children.length : 0,
        x0: root.x0, y0: root.y0, x1: root.x1, y1: root.y1
    });

    // Set initial domains
    x.domain([root.x0, root.x1]);
    y.domain([root.y0, root.y1]);

    // Create SVG
    const svg = d3.create("svg")
        .attr("viewBox", [0.5, -50.5, width, height + 50])
        .style("font", "10px sans-serif");

    // Create initial group
    let group = svg.append("g");

    // Render the initial view
    render(group, root);

    /**
     * Custom tile function for treemap layout
     */
    function tile(node: TreemapNode, x0: number, y0: number, x1: number, y1: number) {
        if (!node.children) return;
        
        // Calculate available space
        const availableWidth = x1 - x0;
        const availableHeight = y1 - y0;
        
        // Ensure values match points
        node.children.forEach(child => {
            (child as any).value = child.data.points || 0;
        });
        
        // Create a simpler hierarchy object that matches d3's expectations
        const tempRoot = {
            children: node.children.map(child => ({
                data: child.data,
                value: child.data.points || 0
            }))
        };
        
        // Create hierarchy and apply squarify directly
        const tempHierarchy = d3.hierarchy(tempRoot)
            .sum(d => (d as any).value);
            
        // Apply squarify directly with the available space
        d3.treemapSquarify(tempHierarchy as d3.HierarchyRectangularNode<any>, 0, 0, availableWidth, availableHeight);
        
        // Transfer positions back to our nodes
        node.children.forEach((child, i) => {
            if (tempHierarchy.children && tempHierarchy.children[i]) {
                const tempNode = tempHierarchy.children[i] as d3.HierarchyRectangularNode<any>;
                child.x0 = x0 + tempNode.x0;
                child.x1 = x0 + tempNode.x1;
                child.y0 = y0 + tempNode.y0;
                child.y1 = y0 + tempNode.y1;
            }
        });
    }

    /**
     * Position elements based on their coordinates
     */
    function position(group, root) {
        console.log('[treemapCore] position - Positioning elements with root:', { 
            name: root.data.name, 
            x0: root.x0, y0: root.y0,
            x1: root.x1, y1: root.y1 
        });
        
        group.selectAll("g")
            .attr("transform", d => {
                if (!d || typeof d.x0 === 'undefined') {
                    console.warn('[treemapCore] position - Invalid coordinates for node:', d ? d.data.name : 'undefined');
                    return '';
                }
                const transform = d === root ? `translate(0,-50)` : `translate(${x(d.x0)},${y(d.y0)})`;
                console.log('[treemapCore] position - Transform for node:', d.data.name, 'Transform:', transform);
                return transform;
            });

        group.selectAll("rect")
            .attr("width", d => {
                if (!d || typeof d.x0 === 'undefined') {
                    console.warn('[treemapCore] position - Cannot calculate width for node:', d ? d.data.name : 'undefined');
                    return 0;
                }
                const rectWidth = d === root ? width : x(d.x1) - x(d.x0);
                console.log('[treemapCore] position - Width for node:', d.data.name, 'Width:', rectWidth);
                return rectWidth;
            })
            .attr("height", d => {
                if (!d || typeof d.y0 === 'undefined') {
                    console.warn('[treemapCore] position - Cannot calculate height for node:', d ? d.data.name : 'undefined');
                    return 0;
                }
                const rectHeight = d === root ? 50 : y(d.y1) - y(d.y0);
                console.log('[treemapCore] position - Height for node:', d.data.name, 'Height:', rectHeight);
                return rectHeight;
            });
    }

    /**
     * Render the treemap
     */
    function render(group, root) {
        console.log('[treemapCore] render - Starting render with root:', { 
            name: root.data.name, 
            children: root.children ? root.children.length : 0 
        });
        
        // Create node data including the root
        const nodeData = (root.children || []).concat(root);
        console.log('[treemapCore] render - Node data created:', nodeData.map(n => ({ 
            name: n.data.name, 
            points: n.data.points,
            hasValidCoords: typeof n.x0 !== 'undefined' && typeof n.y0 !== 'undefined'
        })));

        // Create node groups
        const node = group
            .selectAll("g")
            .data(nodeData)
            .join("g")
            .filter(d => {
                const shouldKeep = d === root || d.data.points > 0;
                console.log('[treemapCore] render - Filtering node:', d.data.name, 'Keep:', shouldKeep);
                return shouldKeep;
            });

        console.log('[treemapCore] render - Node selection created with length:', node.size());
        
        // Position the nodes
        position(group, root);
        console.log('[treemapCore] render - Nodes positioned');
    }

    /**
     * Zoom in to a node
     */
    function zoomin(d) {
        console.log('Zooming in to:', d.data.name);
        currentView = d;
        const group0 = group.attr("pointer-events", "none");
        
        // Update domains first
        x.domain([d.x0, d.x1]);
        y.domain([d.y0, d.y1]);
        
        const group1 = group = svg.append("g");
        render(group1, d);
        
        svg.transition()
            .duration(750)
            .call(t => group0.transition(t).remove()
                .call(position, d.parent))
            .call(t => group1.transition(t)
                .attrTween("opacity", () => d3.interpolate("0", "1") as any)
                .call(position, d));
    }

    /**
     * Zoom out from a node
     */
    function zoomout(d) {
        console.log('Zooming out from:', d.data.name);
        currentView = d.parent;
        const group0 = group.attr("pointer-events", "none");
        
        // Update domains first
        x.domain([d.parent.x0, d.parent.x1]);
        y.domain([d.parent.y0, d.parent.y1]);
        
        const group1 = group = svg.insert("g", "*");
        render(group1, d.parent);
        
        svg.transition()
            .duration(750)
            .call(t => group0.transition(t).remove()
                .attrTween("opacity", () => d3.interpolate("1", "0") as any)
                .call(position, d))
            .call(t => group1.transition(t)
                .call(position, d.parent));
    }
    
    /**
     * Update the tree data without recreating the entire treemap
     * Used when node properties change but structure remains the same
     */
    function updateNodeData(node: AnyTreeNode): void {
        console.log('Updating node data for:', node.name);
        
        // Handle lightweight updates (like name changes)
        // Without rebuilding the entire structure
        if (currentView && currentView.data) {
            // Update any node text or label elements if needed
            group.selectAll("text")
                .filter(d => {
                    // Type guard to ensure d and d.data exist
                    return d && 
                        typeof d === 'object' && 
                        'data' in d && 
                        d.data && 
                        typeof d.data === 'object' && 
                        'id' in d.data && 
                        d.data.id === node.id;
                })
                .text(d => {
                    // Type assertion to safely access d.data.name
                    const dataObj = d as {data: {name: string}};
                    return dataObj.data.name;
                });
        }
    }

    // Return public API
    return {
        element: svg.node() as unknown as HTMLElement,
        update: (newWidth: number, newHeight: number) => {
            // Update scales
            x.rangeRound([0, newWidth]);
            y.rangeRound([0, newHeight]);
            
            // Update SVG viewBox
            svg.attr("viewBox", [0.5, -50.5, newWidth, newHeight + 50]);
            
            // Clear existing content and create new group
            group.remove();  // Remove old group
            group = svg.append("g");  // Create new group
            
            // Update visualization with current view
            render(group, currentView);
        },
        destroy: () => {
            // Clean up any resources
            svg.remove();
        },
        getCurrentView: () => currentView.data,
        getCurrentData: () => data,
        getRoot: () => root,
        getXScale: () => x,
        getYScale: () => y,
        zoomin,
        zoomout,
        updateNodeData
    };
} 