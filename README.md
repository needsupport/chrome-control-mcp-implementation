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
- **Chrome Management** - Automatic Chrome process monitoring and recovery
- **Caching** - Smart, mutation-aware cache invalidation for performance
- **Race Condition Prevention** - Mutex-based locking for concurrent operations
- **Memory Management** - Proper resource cleanup to prevent memory leaks
- **Accessibility Tree** - Access to Chrome's accessibility tree for enhanced semantic understanding

## Architecture

The implementation follows a modular architecture with these key components:

1. **Chrome MCP Server** - Handles incoming requests from AI assistants
2. **Chrome API** - Main interface to browser control
3. **Chrome Process Manager** - Manages Chrome browser lifecycle
4. **Tab Manager** - Centralized tab management
5. **DOM Observer** - Monitors real-time DOM changes
6. **Cache System** - Optimizes performance through intelligent caching
7. **Semantic Analyzer** - Builds semantic representation of pages
8. **Content Extractor** - Extracts structured content from pages
9. **Error Handler** - Provides global error handling and recovery strategies
10. **Accessibility Tree Analyzer** - Extracts and analyzes the accessibility tree

## Getting Started

### Prerequisites

- Node.js 16+
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
   ./start-chrome-mcp.sh
   ```

The start script will automatically:
- Build the TypeScript code if needed
- Find and launch Chrome with the appropriate debugging flags
- Start the MCP server
- Provide a health check endpoint for verification

### Environment Variables

The server can be configured using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3001 |
| CHROME_DEBUGGING_PORT | Chrome debugging port | 9222 |
| MANAGE_CHROME_PROCESS | Enable automatic Chrome management | true |
| CHROME_EXECUTABLE | Path to Chrome executable | auto-detected |
| DEBUG | Enable debug mode | false |
| LOG_LEVEL | Log level (debug, info, warn, error) | info |
| HEALTHCHECK_PATH | Health check endpoint path | /health |
| AUTO_FREE_DEBUG_PORT | Kill process on debug port if in use | false |
| AUTO_FREE_SERVER_PORT | Kill process on server port if in use | false |
| ENABLE_ACCESSIBILITY_TREE | Enable accessibility tree support | true |

## Local Development

This project is designed for local deployment where the Chrome Control MCP server and the AI assistant run on the same machine. The server automatically detects and manages Chrome, handling crashes and restarts without manual intervention.

### Chrome Management

The Chrome Process Manager component has been enhanced to:
- Automatically locate Chrome on Windows, macOS, and Linux
- Monitor Chrome process health and resource usage
- Recover from Chrome crashes with exponential backoff
- Clean up temporary profiles and resources on shutdown

### Port Management

The system now includes intelligent port management to:
- Detect if the Chrome debug port or server port is in use
- Automatically find alternative ports if needed
- Provide detailed error messages for port conflicts

### Health Checks

Enhanced health monitoring is available at:
- `/health` - Basic health status
- `/health/details` - Detailed system information
- `/health/chrome` - Chrome-specific status
- `/livez` - Kubernetes-style liveness probe
- `/readyz` - Kubernetes-style readiness probe

## Usage

The server provides a JSON-RPC API that can be accessed at `http://localhost:3001`. Here's a basic example:

```javascript
// Navigate to a URL
fetch('http://localhost:3001', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json'
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

### Accessibility Tree

You can access and analyze the accessibility tree using the `getAccessibilityTree` method:

```javascript
// Get accessibility tree for analysis
fetch('http://localhost:3001', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'getAccessibilityTree',
    params: { tabId: 'your-tab-id' },
    id: 1
  })
})
.then(response => response.json())
.then(data => {
  const accessibilityTree = data.result.accessibilityTree;
  console.log('Accessibility issues:', accessibilityTree.issues);
  console.log('Accessibility summary:', accessibilityTree.summary);
});
```

## Debugging

To debug the server, you can use the following techniques:

1. Set LOG_LEVEL to "debug" for detailed logs:
   ```bash
   LOG_LEVEL=debug ./start-chrome-mcp.sh
   ```

2. View the health check endpoint for system status:
   ```bash
   curl http://localhost:3001/health/details
   ```

3. Monitor Chrome process status:
   ```bash
   curl http://localhost:3001/health/chrome
   ```

4. Use Chrome DevTools to inspect the Chrome instance:
   Open `chrome://inspect` in a separate Chrome window and look for the controlled instance in the "Remote Target" section.

## Error Handling and Recovery

The system now implements robust error handling and recovery:

1. **Chrome Process Crashes**: Automatically detected and restarted with exponential backoff
2. **Connection Failures**: Detected and reconnected with retry logic
3. **Resource Leaks**: Properly tracked and cleaned up during shutdown
4. **Tab Synchronization**: Mutex-based locking prevents race conditions
5. **Graceful Shutdown**: Proper cleanup of all resources, even during abnormal termination

## Testing

Run the test suite to verify functionality:

```bash
npm test
```

The test suite includes:
- Unit tests for key components
- Integration tests for Chrome Process Manager
- Tests for accessibility tree functionality

## Implementation Status

- [x] Chrome Process Manager - Complete implementation with health monitoring and crash recovery
- [x] Intelligent port management - Detection and resolution of port conflicts
- [x] Health check endpoints - Comprehensive health monitoring 
- [x] Enhanced error handling - Robust recovery from failures
- [x] Resource cleanup - Proper management of temporary files and processes
- [x] Tab management with race condition prevention
- [x] DOM mutation observing
- [x] Semantic DOM analysis
- [x] Content extraction
- [x] Form handling
- [x] Navigation management
- [x] Authentication and security
- [x] Cache system
- [x] Test suite - Basic tests for critical components
- [x] Accessibility tree support - Complete implementation with issue detection

## License

MIT
