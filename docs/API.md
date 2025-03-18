# Chrome Control MCP API Documentation

This document provides comprehensive documentation for the JSON-RPC API provided by the Chrome Control MCP server.

## API Basics

All API calls use the JSON-RPC 2.0 protocol with the following format:

```json
{
  "jsonrpc": "2.0",
  "method": "methodName",
  "params": { 
    "param1": "value1",
    "param2": "value2"
  },
  "id": 1
}
```

The server response follows this format:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "property1": "value1",
    "property2": "value2"
  },
  "id": 1
}
```

Or in case of an error:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Error message"
  },
  "id": 1
}
```

## Authentication

If authentication is enabled, you must include an API key in each request using one of these methods:

1. Authorization header: `Authorization: Bearer YOUR_API_KEY`
2. Custom header: `X-API-Key: YOUR_API_KEY`

## Basic Methods

### initialize()

Initializes a connection to Chrome.

**Params**: None

**Response**:
```json
{
  "success": true
}
```

### navigate(url: string)

Navigates to a specific URL.

**Params**:
- `url`: The URL to navigate to

**Response**:
```json
{
  "tabId": "tab-123",
  "url": "https://example.com"
}
```

### getContent(tabId: string)

Gets the HTML content of a page.

**Params**:
- `tabId`: The ID of the tab

**Response**:
```json
{
  "content": "<html>...</html>"
}
```

### executeScript(tabId: string, script: string)

Executes JavaScript on a page.

**Params**:
- `tabId`: The ID of the tab
- `script`: The JavaScript code to execute

**Response**:
```json
{
  "result": "Any value returned by the script"
}
```

### clickElement(tabId: string, selector: string)

Clicks an element on a page.

**Params**:
- `tabId`: The ID of the tab
- `selector`: CSS selector for the element to click

**Response**:
```json
{
  "success": true
}
```

### takeScreenshot(tabId: string)

Takes a screenshot of a page.

**Params**:
- `tabId`: The ID of the tab

**Response**:
```json
{
  "data": "base64-encoded-image-data"
}
```

### closeTab(tabId: string)

Closes a tab.

**Params**:
- `tabId`: The ID of the tab

**Response**:
```json
{
  "success": true
}
```

## Semantic Understanding Methods

### getStructuredContent(tabId: string)

Gets structured content from a page.

**Params**:
- `tabId`: The ID of the tab

**Response**:
```json
{
  "content": {
    "title": "Page Title",
    "url": "https://example.com",
    "mainContent": {
      "text": "Main content text",
      "children": [...]
    },
    "navigation": [...],
    "forms": [...]
  }
}
```

### analyzePageSemantics(tabId: string)

Analyzes the semantic structure of a page.

**Params**:
- `tabId`: The ID of the tab

**Response**:
```json
{
  "semanticModel": [
    {
      "elementType": "heading",
      "text": "Heading Text",
      "importance": 0.85,
      "semanticId": "sem-123"
    },
    {
      "elementType": "link",
      "text": "Link Text",
      "importance": 0.65,
      "semanticId": "sem-124",
      "href": "https://example.com/page"
    }
  ]
}
```

### findElementsByText(tabId: string, text: string)

Finds elements containing specific text.

**Params**:
- `tabId`: The ID of the tab
- `text`: The text to search for

**Response**:
```json
{
  "elements": [
    {
      "elementType": "paragraph",
      "text": "Text containing the search term",
      "semanticId": "sem-125"
    }
  ]
}
```

### findClickableElements(tabId: string)

Finds all clickable elements on a page.

**Params**:
- `tabId`: The ID of the tab

**Response**:
```json
{
  "elements": [
    {
      "elementType": "button",
      "text": "Submit",
      "importance": 0.75,
      "semanticId": "sem-126"
    },
    {
      "elementType": "link",
      "text": "Learn More",
      "importance": 0.65,
      "semanticId": "sem-127"
    }
  ]
}
```

### clickSemanticElement(tabId: string, semanticId: string)

Clicks an element identified by its semantic ID.

**Params**:
- `tabId`: The ID of the tab
- `semanticId`: The semantic ID of the element

**Response**:
```json
{
  "success": true
}
```

### fillFormField(tabId: string, semanticId: string, value: string)

Fills a form field with a value.

**Params**:
- `tabId`: The ID of the tab
- `semanticId`: The semantic ID of the form field
- `value`: The value to fill

**Response**:
```json
{
  "success": true
}
```

### performSearch(tabId: string, query: string)

Performs a search on a page.

**Params**:
- `tabId`: The ID of the tab
- `query`: The search query

**Response**:
```json
{
  "success": true,
  "resultsCount": 5
}
```

## Error Codes

The server uses the following error codes:

| Code | Message | Description |
|------|---------|-------------|
| -32600 | Invalid Request | Not a valid JSON-RPC 2.0 request |
| -32601 | Method not found | The requested method doesn't exist |
| -32602 | Invalid params | The params are invalid for the method |
| -32603 | Internal error | An internal server error |
| -32000 | Server error | Generic server error |
| -32001 | Unauthorized | Invalid or missing API key |
| -32002 | Too many requests | Rate limit exceeded |
| -32003 | Request too large | Request size exceeds the limit |
| -32700 | Parse error | Invalid JSON |

## Security Considerations

1. **API Key Authentication**: Enable API key authentication in production.
2. **Rate Limiting**: Enable rate limiting to prevent abuse.
3. **Input Validation**: All inputs are validated to prevent injection attacks.
4. **Timeout Protection**: Long-running operations have timeouts.

## Performance Optimizations

1. **Caching**: The server uses caching to optimize performance.
2. **Concurrent Operations**: Mutex-based locking prevents race conditions.
3. **Resource Cleanup**: Proper resource cleanup prevents memory leaks.

## Examples

### Navigating to a URL

```javascript
fetch('http://localhost:3001', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'navigate',
    params: { url: 'https://example.com' },
    id: 1
  })
})
.then(response => response.json())
.then(data => console.log(data));
```

### Analyzing a Page

```javascript
// First, navigate to a page
fetch('http://localhost:3001', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'navigate',
    params: { url: 'https://example.com' },
    id: 1
  })
})
.then(response => response.json())
.then(data => {
  const tabId = data.result.tabId;
  
  // Then, analyze the page
  return fetch('http://localhost:3001', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'analyzePageSemantics',
      params: { tabId },
      id: 2
    })
  });
})
.then(response => response.json())
.then(data => console.log(data));
```

### Finding and Clicking Elements

```javascript
// Find clickable elements
fetch('http://localhost:3001', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'findClickableElements',
    params: { tabId: 'tab-123' },
    id: 3
  })
})
.then(response => response.json())
.then(data => {
  const elementId = data.result.elements[0].semanticId;
  
  // Click the first element
  return fetch('http://localhost:3001', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'clickSemanticElement',
      params: { tabId: 'tab-123', semanticId: elementId },
      id: 4
    })
  });
})
.then(response => response.json())
.then(data => console.log(data));
```
