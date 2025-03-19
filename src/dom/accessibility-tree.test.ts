/**
 * Accessibility Tree Tests
 * 
 * Unit tests for the accessibility tree functionality
 */

import { getAccessibilityTree, AccessibilityNode, AccessibilityImpact } from './accessibility-tree';

// Mock CDP client
const createMockCdpClient = () => {
  const client = {
    send: jest.fn().mockImplementation((method: string, params?: any) => {
      if (method === 'Accessibility.getFullAXTree') {
        return Promise.resolve({
          nodes: [
            {
              nodeId: '1',
              role: { value: 'RootWebArea' },
              name: { value: 'Test Page' },
              properties: [
                { name: 'url', value: { value: 'https://example.com' } }
              ],
              childIds: ['2', '3']
            },
            {
              nodeId: '2',
              role: { value: 'heading' },
              name: { value: 'Welcome to Example' },
              properties: [
                { name: 'aria-level', value: { value: '1' } }
              ]
            },
            {
              nodeId: '3',
              role: { value: 'button' },
              name: { value: 'Click Me' },
              properties: [
                { name: 'aria-pressed', value: { value: 'false' } }
              ]
            }
          ]
        });
      }
      return Promise.resolve({});
    })
  };
  return client;
};

describe('Accessibility Tree', () => {
  let mockClient: any;
  
  beforeEach(() => {
    mockClient = createMockCdpClient();
  });
  
  test('should extract accessibility tree from CDP response', async () => {
    const result = await getAccessibilityTree(mockClient, 'tab123');
    
    // Verify the method was called correctly
    expect(mockClient.send).toHaveBeenCalledWith('Accessibility.getFullAXTree');
    
    // Verify the returned structure
    expect(result).toHaveProperty('tree');
    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('summary');
    
    // Verify the tree structure
    const tree = result.tree;
    expect(tree.nodeId).toBe('1');
    expect(tree.role).toBe('RootWebArea');
    expect(tree.name).toBe('Test Page');
    
    // Verify children
    expect(tree.children?.length).toBe(2);
    expect(tree.children?.[0].role).toBe('heading');
    expect(tree.children?.[1].role).toBe('button');
  });
  
  test('should detect accessibility issues in the tree', async () => {
    // Mock CDP response with accessibility issues
    mockClient.send.mockImplementationOnce(() => ({
      nodes: [
        {
          nodeId: '1',
          role: { value: 'RootWebArea' },
          childIds: ['2', '3', '4']
        },
        {
          nodeId: '2',
          role: { value: 'button' },
          // Missing name - should trigger an issue
          properties: []
        },
        {
          nodeId: '3',
          role: { value: 'image' },
          // Missing alt text - should trigger an issue
          properties: []
        },
        {
          nodeId: '4',
          role: { value: 'heading' },
          name: { value: 'Heading without level' },
          // Missing aria-level - should trigger a warning
          properties: []
        }
      ]
    }));
    
    const result = await getAccessibilityTree(mockClient, 'tab123');
    
    // Should have 3 issues
    expect(result.issues.length).toBe(3);
    
    // Verify issue types
    const buttonIssue = result.issues.find(issue => 
      issue.nodeId === '2' && issue.message.includes('button')
    );
    expect(buttonIssue).toBeDefined();
    expect(buttonIssue?.type).toBe('error');
    expect(buttonIssue?.impact).toBe(AccessibilityImpact.SERIOUS);
    
    const imageIssue = result.issues.find(issue => 
      issue.nodeId === '3' && issue.message.includes('image')
    );
    expect(imageIssue).toBeDefined();
    expect(imageIssue?.type).toBe('error');
    
    const headingIssue = result.issues.find(issue => 
      issue.nodeId === '4' && issue.message.includes('level')
    );
    expect(headingIssue).toBeDefined();
    expect(headingIssue?.type).toBe('warning');
    
    // Summary should match the issues count
    expect(result.summary.issueCount).toBe(3);
  });
  
  test('should handle empty node response', async () => {
    // Mock empty response
    mockClient.send.mockImplementationOnce(() => ({ nodes: [] }));
    
    const result = await getAccessibilityTree(mockClient, 'tab123');
    
    // Should still return a valid structure
    expect(result.tree).toBeDefined();
    expect(result.issues).toEqual([]);
    expect(result.summary.totalNodes).toBe(1); // Just the root node
  });
  
  test('should handle error during tree extraction', async () => {
    // Mock error response
    mockClient.send.mockImplementationOnce(() => {
      throw new Error('CDP Error');
    });
    
    await expect(getAccessibilityTree(mockClient, 'tab123'))
      .rejects.toThrow('Failed to get accessibility tree: CDP Error');
  });
});

// Additional tests for utility functions
describe('Accessibility Tree Utility Functions', () => {
  test('findNodesByRole should find nodes by role', () => {
    const tree: AccessibilityNode = {
      nodeId: 'root',
      role: 'RootWebArea',
      children: [
        { nodeId: '1', role: 'heading', name: 'Title' },
        { nodeId: '2', role: 'button', name: 'OK' },
        { nodeId: '3', role: 'button', name: 'Cancel' }
      ]
    };
    
    // Import the utility function from the actual module
    const { findNodesByRole } = require('./accessibility-tree');
    
    const buttons = findNodesByRole(tree, 'button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].name).toBe('OK');
    expect(buttons[1].name).toBe('Cancel');
    
    const headings = findNodesByRole(tree, 'heading');
    expect(headings.length).toBe(1);
    expect(headings[0].name).toBe('Title');
  });
  
  test('findNodesByName should find nodes by name', () => {
    const tree: AccessibilityNode = {
      nodeId: 'root',
      role: 'RootWebArea',
      children: [
        { nodeId: '1', role: 'heading', name: 'Welcome Page' },
        { nodeId: '2', role: 'button', name: 'Welcome User' },
        { nodeId: '3', role: 'link', name: 'Contact' }
      ]
    };
    
    // Import the utility function from the actual module
    const { findNodesByName } = require('./accessibility-tree');
    
    const welcomeNodes = findNodesByName(tree, 'Welcome');
    expect(welcomeNodes.length).toBe(2);
    expect(welcomeNodes[0].role).toBe('heading');
    expect(welcomeNodes[1].role).toBe('button');
    
    // Case insensitive search
    const contactNodes = findNodesByName(tree, 'contact');
    expect(contactNodes.length).toBe(1);
    expect(contactNodes[0].role).toBe('link');
  });
});
