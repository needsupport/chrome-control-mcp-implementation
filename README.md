# Chrome Control MCP Implementation

Implementation of the [chrome-control-mcp](https://github.com/needsupport/chrome-control-mcp) roadmap, providing efficient web browsing capabilities for AI assistants without relying on screenshots.

## Project Overview

The Chrome Control MCP (Model Context Protocol) server enables AI assistants to interact with web pages in a more efficient and semantic manner compared to traditional screenshot-based approaches. By directly analyzing the DOM (Document Object Model), it provides a rich understanding of web page structure and content.

## Key Features

- **DOM Mutation Observers** - Real-time updates for dynamic content changes
- **Semantic DOM Analysis** - Deep understanding of page structure and content
- **Content Extraction** - Extracts structured content from web pages
- **Form Handling** - Identifies and interacts with forms accurately
- **Navigation Management** - Handles complex navigation scenarios reliably
- **Error Recovery** - Sophisticated error handling with recovery strategies
- **Security** - API key authentication and rate limiting
- **Caching** - Smart, mutation-aware cache invalidation for performance
- **Race Condition Prevention** - Mutex-based locking for concurrent operations
- **Memory Management** - Proper resource cleanup to prevent memory leaks

## Architecture

The implementation follows a modular architecture with these key components:

1. **Chrome MCP Server** - Handles incoming requests from AI assistants
2. **Chrome API** - Main interface to browser control
3. **Tab Manager** - Centralized tab management
4. **DOM Observer** - Monitors real-time DOM changes
5. **Cache System** - Optimizes performance through intelligent caching
6. **Semantic Analyzer** - Builds semantic representation of pages
7. **Content Extractor** - Extracts structured content from pages
8. **Auth Manager** - Provides API key-based authentication
9. **Error Handler** - Provides global error handling and recovery strategies
10. **Security Manager** - Handles input validation and sanitization

## Getting Started

### Prerequisites

- Node.js 16+
- Chrome browser
- npm or yarn

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/needsupport/chrome-control-mcp-implementation.git
   cd chrome-control-mcp-implementation
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Start the server:
   ```bash
   npm start
   ```
   
   Or use the convenience script:
   ```bash
   ./start-chrome-mcp.sh
   ```

## Environment Variables

The server can be configured using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3001 |
| CHROME_DEBUGGING_PORT | Chrome debugging port | 9222 |
| DEBUG | Enable debug mode | false |
| LOG_LEVEL | Log level (debug, info, warn, error) | info |
| AUTH_ENABLED | Enable API key authentication | false |
| API_KEYS | Comma-separated list of valid API keys | [] |
| GENERATE_API_KEY_ON_STARTUP | Generate API key on startup | true |
| RATE_LIMIT_ENABLED | Enable rate limiting | false |
| RATE_LIMIT_REQUESTS | Max requests per window | 100 |
| RATE_LIMIT_WINDOW | Time window in ms | 60000 |
| REQUEST_TIMEOUT | Timeout for operations in ms | 30000 |
| MAX_CACHE_SIZE | Maximum number of items in cache | 1000 |

## Usage

The server provides a JSON-RPC API that can be accessed at `http://localhost:3001`. Here's a basic example:

```javascript
// Navigate to a URL
fetch('http://localhost:3001', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY' // If auth is enabled
  },
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
  console.log(`Page loaded in tab: ${tabId}`);
});
```

## Examples

- **analyze-page.ts** - Demonstrates how to analyze a web page's structure
- **search-and-extract.ts** - Shows how to perform a search and extract content

Run examples with:

```bash
npx ts-node examples/analyze-page.ts https://example.com
```

## Security

This implementation includes security features:

1. **API Key Authentication** - Secure access using API keys
2. **Rate Limiting** - Protection against abuse
3. **Request Validation** - Ensures valid requests
4. **CORS Control** - Configurable same-origin policy
5. **Request Size Limits** - Prevents payload attacks
6. **Input Sanitization** - Prevents injection attacks
7. **Timeout Protection** - Guards against long-running operations

## Performance Optimizations

1. **Smart Caching** - Automatic cache invalidation based on DOM mutations
2. **Tab Management** - Efficient handling of browser tabs
3. **Content Chunking** - Processing large pages in manageable chunks
4. **Resource Limits** - Configurable settings to prevent resource exhaustion
5. **LRU Caching** - Efficient management of cached data
6. **Optimized DOM Handling** - Efficient processing of DOM mutations
7. **Mutex Locking** - Prevents race conditions in concurrent operations

## Error Handling

1. **Global Error Handlers** - Captures uncaught exceptions and unhandled rejections
2. **Graceful Shutdown** - Proper cleanup of resources during errors
3. **Automatic Recovery** - Retries operations when possible
4. **Detailed Error Reporting** - Provides helpful error messages
5. **Transaction Rollback** - Reverts partial operations on failure

## Implementation Status

- [x] Basic server structure
- [x] Chrome API wrapper
- [x] Tab management
- [x] DOM mutation observing
- [x] Cache system
- [x] Authentication and security
- [x] Rate limiting
- [x] Race condition prevention
- [x] Memory leak prevention
- [x] Input validation and sanitization
- [x] Global error handling
- [x] Enhanced semantic analyzer - *Improved implementation*
- [ ] Content extractor - *Partial implementation*
- [ ] Accessibility tree support - *Planned*
- [ ] Test suite - *Planned*

## License

MIT
