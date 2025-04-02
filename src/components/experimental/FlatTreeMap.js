import * as d3 from 'd3';
import { getColorForName } from '../../utils/colorUtils.js';
import { calculateFontSize } from '../../utils/fontUtils.js';

// lets just visualize: rootNode.sharesOfGeneralFulfillment for the proportions!
// and the mutual-recognition of each relation!
// lets display each role, and see the state for desire, mutual-desire, playing, mutual-playing, surplus
// lets display the incoming char-stream for each node! (messaging) each one should scale to show a proportion of the total-chars.

export function createTreemap(rootNode, width, height) {
    // Validate input
    if (!rootNode) {
        console.error('Invalid root node for treemap:', rootNode);
        return {
            element: document.createElement('div'),
            getCurrentView: () => null,
            update: () => {}
        };
    }

    // Get distribution data
    const distributionData = rootNode.shareOfGeneralFulfillmentDistribution;
    console.log('Distribution data:', distributionData);

    // Create hierarchy for treemap
    const hierarchyData = {
        name: "root",
        children: distributionData.map(d => ({
            name: d.type,
            value: d.value * 100 // Convert to percentage
        }))
    };

    // Create scales
    const x = d3.scaleLinear().rangeRound([0, width]);
    const y = d3.scaleLinear().rangeRound([0, height]);

    // Create hierarchy and treemap layout
    let hierarchy = d3.hierarchy(hierarchyData)
        .sum(d => d.value);
    
    let root = d3.treemap()
        .tile(d3.treemapSquarify)
        .size([width, height])
        (hierarchy);

    // Create SVG
    const svg = d3.create("svg")
        .attr("viewBox", [0, 0, width, height])
        .style("font", "10px sans-serif");

    // Create cells
    const leaf = svg.selectAll("g")
        .data(root.leaves())
        .join("g")
        .attr("transform", d => `translate(${d.x0},${d.y0})`);

    // Add rectangles
    leaf.append("rect")
        .attr("fill", d => getColorForName(d.data.name))
        .attr("fill-opacity", 0.8)
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0);

    // Add text labels
    leaf.append("text")
        .attr("x", d => (d.x1 - d.x0) / 2)
        .attr("y", d => (d.y1 - d.y0) / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .style("font-size", d => {
            const rectWidth = d.x1 - d.x0;
            const rectHeight = d.y1 - d.y0;
            return calculateFontSize(d, rectWidth, rectHeight) + "px";
        })
        .text(d => `${d.data.name}\n${d.data.value.toFixed(1)}%`)
        .attr("fill", "white");

    // Return public interface
    return {
        element: svg.node(),
        getCurrentView: () => root,
        update: (newWidth, newHeight) => {
            // Update scales
            x.rangeRound([0, newWidth]);
            y.rangeRound([0, newHeight]);
            
            // Update SVG viewBox
            svg.attr("viewBox", [0, 0, newWidth, newHeight]);
            
            // Update treemap layout
            root = d3.treemap()
                .size([newWidth, newHeight])
                (hierarchy);

            // Update positions
            leaf.attr("transform", d => `translate(${d.x0},${d.y0})`);
            
            // Update rectangles
            leaf.select("rect")
                .attr("width", d => d.x1 - d.x0)
                .attr("height", d => d.y1 - d.y0);

            // Update text
            leaf.select("text")
                .attr("x", d => (d.x1 - d.x0) / 2)
                .attr("y", d => (d.y1 - d.y0) / 2)
                .style("font-size", d => {
                    const rectWidth = d.x1 - d.x0;
                    const rectHeight = d.y1 - d.y0;
                    return calculateFontSize(d, rectWidth, rectHeight) + "px";
                });
        }
    };
}
