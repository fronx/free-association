<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import { getUserName } from '../utils/userUtils';
  import { getColorForUserId } from '../utils/colorUtils';
  import type { TreeNode } from '../models/ReactTreeNode';

  export let data: TreeNode;
  
  let pieContainer: HTMLElement;
  let chart: SVGElement | null = null;

  onMount(() => {
    if (pieContainer) {
      renderPieChart();
    }
  });

  $: if (data && pieContainer) {
    renderPieChart();
  }

  function renderPieChart() {
    // Clear previous chart if it exists
    if (chart) {
      pieContainer.removeChild(chart);
    }
    
    // Get the container dimensions
    const width = pieContainer.clientWidth;
    const height = pieContainer.clientHeight;
    const radius = Math.min(width, height) / 2;

    try {
      // Get mutualFulfillmentDistribution from root node
      const mutualFulfillmentDistribution = data.mutualFulfillmentDistribution;

      // Create an array of [nodeId, value] pairs for the pie chart
      const pieData: [string, number][] = Array.from(mutualFulfillmentDistribution.entries());

      // If there's no data, create a placeholder pie chart
      if (pieData.length === 0) {
        chart = createPlaceholderPieChart(width, height, radius);
      } else {
        // Create pie layout
        const pie = d3.pie<[string, number]>()
          .value(d => d[1])  // Use the mutualFulfillmentDistribution value
          .sort(null);  // Maintain original order

        // Create arc generator
        const arc = d3.arc()
          .innerRadius(radius * 0.4)  // Create a donut chart
          .outerRadius(radius * 0.8);

        // Create SVG
        const svg = d3.create("svg")
          .attr("width", width)
          .attr("height", height)
          .attr("viewBox", [-width/2, -height/2, width, height])
          .style("font", "12px sans-serif");
            
        // Create pie segments from mutualFulfillmentDistribution
        const arcs = pie(pieData);

        // Add segments using the same color scheme as the treemap
        svg.selectAll("path")
          .data(arcs)
          .join("path")
          .attr("fill", d => {
            // Use the node ID to get a name for the color
            return getColorForUserId(d.data[0]);
          })
          .attr("d", d => arc(d as any))  // Type assertion to fix type error
          .append("title") 
          .text(d => {
            const nodeName = getUserName(d.data[0]);
            return `${nodeName}: ${(d.data[1] * 100).toFixed(1)}%`;
          });

        // Add labels with node names
        svg.selectAll("text")
          .data(arcs)
          .join("text")
          .attr("transform", d => {
            const [x, y] = arc.centroid(d as any);
            return `translate(${x}, ${y})`;
          })
          .attr("dy", "0.35em")
          .attr("text-anchor", "middle")
          .attr("fill", "white")
          .style("font-size", "10px")
          .style("pointer-events", "none")
          .style("text-shadow", "0px 0px 2px rgba(0,0,0,0.8)")
          .text(d => {
            const nodeName = getUserName(d.data[0]);
            if (nodeName.length < 10) {
              return nodeName;
            }
            // Don't show text for long names
            return "";
          });

        // Add center text
        const centerGroup = svg.append("g")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle");

        // Calculate text size based on inner radius
        const fontSize = radius * 0.12;  // 12% of radius
        
        centerGroup.append("text")
          .attr("dy", -fontSize/1.6)  // Center it
          .attr("font-size", fontSize)
          .attr("font-weight", "bold")
          .text("Mutual");

        centerGroup.append("text")
          .attr("dy", fontSize/1.6)  // Move down by one full font size
          .attr("font-size", fontSize)
          .attr("font-weight", "bold")
          .text("Fulfillment");

        chart = svg.node();
      }
      
      if (chart) {
        pieContainer.appendChild(chart);
      }
    } catch (error) {
      console.error('Error creating pie chart:', error);
      chart = createPlaceholderPieChart(width, height, radius);
      if (chart) {
        pieContainer.appendChild(chart);
      }
    }
  }

  // Helper function to create placeholder pie chart when no data is available
  function createPlaceholderPieChart(width: number, height: number, radius: number) {
    // Create SVG
    const svg = d3.create("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [-width/2, -height/2, width, height])
      .style("font", "12px sans-serif");
    
    // Add gray empty circle
    svg.append("circle")
      .attr("r", radius * 0.8)
      .attr("fill", "#f0f0f0")
      .attr("stroke", "#e0e0e0")
      .attr("stroke-width", 2);
    
    // Add donut hole
    svg.append("circle")
      .attr("r", radius * 0.4)
      .attr("fill", "white");
    
    // Add center text
    const centerGroup = svg.append("g")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle");

    // Calculate text size based on inner radius
    const fontSize = radius * 0.12;
    
    centerGroup.append("text")
      .attr("dy", -fontSize/1.6)
      .attr("font-size", fontSize)
      .attr("font-weight", "bold")
      .text("Mutual");

    centerGroup.append("text")
      .attr("dy", fontSize/1.6)
      .attr("font-size", fontSize)
      .attr("font-weight", "bold")
      .text("Fulfillment");
    
    // Add message about no data
    svg.append("text")
      .attr("y", radius * 0.6)
      .attr("text-anchor", "middle")
      .attr("font-size", "12px")
      .attr("fill", "#999");
    
    return svg.node();
  }
</script>

<div id="pie-container" bind:this={pieContainer} class="pie-container"></div>

<style>
  .pie-container {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
