import type { TreeNode } from '../../models/TreeNode';
// The ReactTreeNode is actually exported as TreeNode from the ReactTreeNode module
import type { TreeNode as ReactTreeNode } from '../../models/ReactTreeNode';
import type * as d3 from 'd3';

// Define the type for a treemap node
export type TreemapNode = d3.HierarchyRectangularNode<TreeNode | ReactTreeNode>;

// Define the return type for the treemap function
export interface TreemapInstance {
    element: HTMLElement;
    update: (width: number, height: number) => void;
    destroy: () => void;
    getCurrentView: () => TreeNode | ReactTreeNode;
    getCurrentData: () => TreeNode | ReactTreeNode;
    getRoot: () => TreemapNode;
    getXScale: () => d3.ScaleLinear<number, number>;
    getYScale: () => d3.ScaleLinear<number, number>;
    zoomin: (node: TreeNode | ReactTreeNode) => void;
    zoomout: (node: TreeNode | ReactTreeNode) => void;
    updateNodeData: (node: TreeNode | ReactTreeNode) => void;
}

// Configuration for the treemap
export interface TreemapConfig {
    width: number;
    height: number;
    growthRate?: number;
    growthTick?: number;
    growthDelay?: number;
}

// Props for the TreeMapNode component
export interface NodeProps {
    node: TreemapNode;
    isRoot: boolean;
    x: d3.ScaleLinear<number, number>;
    y: d3.ScaleLinear<number, number>;
    currentView: TreemapNode;
    zoomin?: (node: TreemapNode) => void;
    zoomout?: (node: TreemapNode) => void;
} 