# Accessibility Tree Support

The Accessibility Tree feature provides a way to extract and analyze the accessibility tree from web pages via the Chrome DevTools Protocol. This enables AI assistants to understand the semantic structure of web pages from an accessibility perspective and identify potential accessibility issues.

## Overview

The Accessibility Tree is a subset of the DOM that represents the elements on a page from an accessibility perspective. It includes properties like roles, names, descriptions, and states that are relevant for accessibility tools such as screen readers.

This implementation:

1. Extracts the full accessibility tree from a page
2. Provides a structured representation of the tree
3. Analyzes the tree for common accessibility issues
4. Generates a summary of accessibility findings

## API Reference

### getAccessibilityTree

```javascript
// JSON-RPC method
{
  "method": "getAccessibilityTree",
  "params": {
    "tabId": "your-tab-id"
  }
}
```

**Returns:**

```javascript
{
  "accessibilityTree": {
    "tree": {
      // Root accessibility node
      "nodeId": "1",
      "role": "RootWebArea",
      "name": "Page Title",
      "children": [
        // Child nodes
      ]
    },
    "issues": [
      {
        "type": "error" | "warning",
        "nodeId": "2",
        "message": "Button is missing an accessible name",
        "impact": "serious" | "critical" | "moderate" | "minor",
        "help": "Add aria-label or aria-labelledby attribute",
        "helpUrl": "https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html"
      }
    ],
    "summary": {
      "totalNodes": 150,
      "issueCount": 5,
      "criticalIssues": 0,
      "seriousIssues": 3,
      "moderateIssues": 2,
      "minorIssues": 0
    }
  }
}
```

## Accessibility Node Structure

Each accessibility node has the following structure:

```typescript
interface AccessibilityNode {
  nodeId: string;         // Unique identifier for the node
  role: string;           // ARIA role (e.g., button, link, heading)
  name?: string;          // Accessible name
  value?: string;         // Value (for form elements)
  description?: string;   // Description
  properties?: Record<string, string>; // Additional properties
  children?: AccessibilityNode[]; // Child nodes
}
```

## Types of Accessibility Issues

The analyzer detects various types of accessibility issues, including:

1. **Missing accessible names** - Elements like buttons, links, and form controls that lack an accessible name
2. **Missing alternative text** - Images without alt text
3. **Improper heading structure** - Headings without proper levels
4. **Color contrast issues** - Text with potentially insufficient color contrast (when available)

Issues are categorized by their impact:

- **Critical** - Severe barriers that prevent users from accessing core functionality
- **Serious** - Significant barriers that may prevent users from accessing important functionality
- **Moderate** - Barriers that may cause confusion or difficulty
- **Minor** - Issues that might impact some users but have less severe consequences

## Usage Example

See the [accessibility-analysis.js](../examples/accessibility-analysis.js) example script for a complete usage demonstration.

Basic usage:

```javascript
// Navigate to a page first
const navigateResult = await sendRequest('navigate', { url: 'https://example.com' });
const tabId = navigateResult.tabId;

// Get the accessibility tree
const accessibilityResult = await sendRequest('getAccessibilityTree', { tabId });
const { tree, issues, summary } = accessibilityResult.accessibilityTree;

// Analyze issues
console.log(`Found ${summary.issueCount} accessibility issues`);
```

## Utility Functions

The implementation includes utility functions for working with accessibility trees:

- `findNodesByRole(tree, role)` - Find nodes by their ARIA role
- `findNodesByName(tree, name)` - Find nodes by their accessible name 
- `extractLandmarks(tree)` - Extract landmark regions from the page

## Configuration

The accessibility tree feature can be configured through environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| ENABLE_ACCESSIBILITY_TREE | Enable accessibility tree support | true |
| MAX_ACCESSIBILITY_NODES | Maximum number of nodes to process | 5000 |

## Limitations

- The accessibility tree is only as good as the information provided by the page
- Some dynamic content may not be fully represented
- Complex web applications may generate very large accessibility trees
- Color contrast analysis depends on Chrome's built-in contrast scoring

## Performance Considerations

Extracting the full accessibility tree can be resource-intensive for complex pages. Consider using caching to avoid repeated extractions for the same page state.
