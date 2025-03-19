/**
 * Accessibility Tree Support
 * 
 * Extracts and analyzes the accessibility tree from web pages
 */

import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import { retry } from '../utils/retry.js';

const logger = new Logger('accessibility-tree');

/**
 * Types of accessibility nodes
 */
export enum AccessibilityRole {
  BUTTON = 'button',
  LINK = 'link',
  HEADING = 'heading',
  TEXT = 'text',
  IMAGE = 'image',
  LIST = 'list',
  LIST_ITEM = 'listitem',
  TABLE = 'table',
  FORM = 'form',
  CHECKBOX = 'checkbox',
  RADIO = 'radio',
  TAB = 'tab',
  TABPANEL = 'tabpanel',
  MENU = 'menu',
  MENUITEM = 'menuitem',
  TREE = 'tree',
  TREEITEM = 'treeitem',
  DIALOG = 'dialog',
  ALERT = 'alert',
  NAVIGATION = 'navigation',
  MAIN = 'main',
  FOOTER = 'footer',
  HEADER = 'header',
  REGION = 'region',
  UNKNOWN = 'unknown'
}

/**
 * Accessibility node interface
 */
export interface AccessibilityNode {
  nodeId: string;
  role: string;
  name?: string;
  value?: string;
  description?: string;
  properties?: Record<string, string>;
  children?: AccessibilityNode[];
}

/**
 * Issue severity levels
 */
export enum AccessibilityImpact {
  CRITICAL = 'critical',
  SERIOUS = 'serious',
  MODERATE = 'moderate',
  MINOR = 'minor'
}

/**
 * Accessibility issue interface
 */
export interface AccessibilityIssue {
  type: 'error' | 'warning';
  nodeId: string;
  message: string;
  impact: AccessibilityImpact;
  help?: string;
  helpUrl?: string;
}

/**
 * Accessibility tree analysis result
 */
export interface AccessibilityTreeResult {
  tree: AccessibilityNode;
  issues: AccessibilityIssue[];
  summary: {
    totalNodes: number;
    issueCount: number;
    criticalIssues: number;
    seriousIssues: number;
    moderateIssues: number;
    minorIssues: number;
  };
}

/**
 * Extract the accessibility tree from a page
 * @param client CDP client
 * @param tabId Tab ID
 */
export async function getAccessibilityTree(client: any, tabId: string): Promise<AccessibilityTreeResult> {
  logger.debug(`Getting accessibility tree for tab ${tabId}`);
  
  try {
    // Use Chrome DevTools Protocol to get the accessibility tree
    const result = await retry(
      async () => client.send('Accessibility.getFullAXTree'),
      {
        retries: 3,
        minTimeout: 1000,
        onRetry: (error, attempt) => {
          logger.warn(`Retrying accessibility tree retrieval (attempt ${attempt}/3): ${error.message}`);
        }
      }
    );
    
    if (!result || !result.nodes) {
      throw new Error('Failed to get accessibility tree: empty response');
    }
    
    // Transform CDP response into our accessibility tree format
    const tree = transformAccessibilityTree(result.nodes);
    
    // Analyze the tree for accessibility issues
    const issues = analyzeAccessibilityTree(tree);
    
    // Generate summary statistics
    const summary = generateSummary(tree, issues);
    
    return {
      tree,
      issues,
      summary
    };
  } catch (error) {
    logger.error(`Error getting accessibility tree: ${error.message}`);
    throw new Error(`Failed to get accessibility tree: ${error.message}`);
  }
}

/**
 * Transform Chrome DevTools Protocol response into our accessibility tree format
 */
function transformAccessibilityTree(nodes: any[]): AccessibilityNode {
  // Find the root node (usually the first one)
  const rootNode = nodes.find(node => node.role?.value === 'RootWebArea') || nodes[0];
  
  if (!rootNode) {
    logger.warn('No root node found in accessibility tree');
    return {
      nodeId: 'root',
      role: 'RootWebArea'
    };
  }
  
  // Recursive function to build the tree
  function buildNode(node: any): AccessibilityNode {
    const properties: Record<string, string> = {};
    
    // Extract properties from CDP format
    if (node.properties) {
      for (const prop of node.properties) {
        if (prop.name && prop.value?.value) {
          properties[prop.name] = prop.value.value;
        }
      }
    }
    
    // Build the node
    const accessibilityNode: AccessibilityNode = {
      nodeId: node.nodeId?.toString() || '',
      role: node.role?.value || 'unknown',
      name: node.name?.value,
      value: node.value?.value,
      description: node.description?.value,
      properties
    };
    
    // Process children recursively
    if (node.childIds && node.childIds.length > 0) {
      accessibilityNode.children = node.childIds
        .map((childId: string) => nodes.find((n: any) => n.nodeId === childId))
        .filter(Boolean)
        .map(buildNode);
    }
    
    return accessibilityNode;
  }
  
  return buildNode(rootNode);
}

/**
 * Analyze the accessibility tree for common issues
 */
function analyzeAccessibilityTree(tree: AccessibilityNode): AccessibilityIssue[] {
  const issues: AccessibilityIssue[] = [];
  
  // Recursive function to check each node
  function checkNode(node: AccessibilityNode) {
    // Check for missing accessible names on interactive elements
    if (['button', 'link', 'checkbox', 'radio'].includes(node.role) && !node.name) {
      issues.push({
        type: 'error',
        nodeId: node.nodeId,
        message: `${node.role} is missing an accessible name`,
        impact: AccessibilityImpact.SERIOUS,
        help: 'Add aria-label, aria-labelledby, or visible text content',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html'
      });
    }
    
    // Check for missing alt text on images
    if (node.role === 'image' && !node.name) {
      issues.push({
        type: 'error',
        nodeId: node.nodeId,
        message: 'Image is missing alternative text',
        impact: AccessibilityImpact.SERIOUS,
        help: 'Add alt attribute to provide a text alternative',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html'
      });
    }
    
    // Check for improper heading structure
    if (node.role === 'heading') {
      const level = parseInt(node.properties?.['aria-level'] || '0', 10);
      if (isNaN(level) || level < 1) {
        issues.push({
          type: 'warning',
          nodeId: node.nodeId,
          message: 'Heading has no level specified',
          impact: AccessibilityImpact.MODERATE,
          help: 'Use h1-h6 elements or set aria-level',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html'
        });
      }
    }
    
    // Check for sufficient color contrast (simplified check)
    if (node.properties && node.properties['color-contrast-score']) {
      const score = parseFloat(node.properties['color-contrast-score']);
      if (score < 4.5) {
        issues.push({
          type: 'warning',
          nodeId: node.nodeId,
          message: 'Element may have insufficient color contrast',
          impact: AccessibilityImpact.MODERATE,
          help: 'Ensure color contrast ratio of at least 4.5:1 for normal text',
          helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html'
        });
      }
    }
    
    // Check children recursively
    if (node.children) {
      node.children.forEach(checkNode);
    }
  }
  
  checkNode(tree);
  return issues;
}

/**
 * Generate summary statistics for the accessibility tree and issues
 */
function generateSummary(tree: AccessibilityNode, issues: AccessibilityIssue[]): {
  totalNodes: number;
  issueCount: number;
  criticalIssues: number;
  seriousIssues: number;
  moderateIssues: number;
  minorIssues: number;
} {
  // Count total nodes
  let totalNodes = 0;
  
  function countNodes(node: AccessibilityNode) {
    totalNodes++;
    if (node.children) {
      node.children.forEach(countNodes);
    }
  }
  
  countNodes(tree);
  
  // Count issues by impact
  const criticalIssues = issues.filter(issue => issue.impact === AccessibilityImpact.CRITICAL).length;
  const seriousIssues = issues.filter(issue => issue.impact === AccessibilityImpact.SERIOUS).length;
  const moderateIssues = issues.filter(issue => issue.impact === AccessibilityImpact.MODERATE).length;
  const minorIssues = issues.filter(issue => issue.impact === AccessibilityImpact.MINOR).length;
  
  return {
    totalNodes,
    issueCount: issues.length,
    criticalIssues,
    seriousIssues,
    moderateIssues,
    minorIssues
  };
}

/**
 * Extract important landmarks from the accessibility tree
 */
export function extractLandmarks(tree: AccessibilityNode): Record<string, AccessibilityNode> {
  const landmarks: Record<string, AccessibilityNode> = {};
  
  function findLandmarks(node: AccessibilityNode) {
    // Check if this is a landmark node
    if (['navigation', 'main', 'banner', 'contentinfo', 'search', 'form', 'region'].includes(node.role)) {
      landmarks[node.role] = node;
    }
    
    // Check children
    if (node.children) {
      node.children.forEach(findLandmarks);
    }
  }
  
  findLandmarks(tree);
  return landmarks;
}

/**
 * Find specific nodes in the accessibility tree by role
 */
export function findNodesByRole(tree: AccessibilityNode, role: string): AccessibilityNode[] {
  const results: AccessibilityNode[] = [];
  
  function searchNodes(node: AccessibilityNode) {
    if (node.role === role) {
      results.push(node);
    }
    
    if (node.children) {
      node.children.forEach(searchNodes);
    }
  }
  
  searchNodes(tree);
  return results;
}

/**
 * Find specific nodes in the accessibility tree by name
 */
export function findNodesByName(tree: AccessibilityNode, name: string): AccessibilityNode[] {
  const results: AccessibilityNode[] = [];
  
  function searchNodes(node: AccessibilityNode) {
    if (node.name && node.name.toLowerCase().includes(name.toLowerCase())) {
      results.push(node);
    }
    
    if (node.children) {
      node.children.forEach(searchNodes);
    }
  }
  
  searchNodes(tree);
  return results;
}
