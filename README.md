# Chrome Control MCP Implementation

This repository implements the roadmap for the [chrome-control-mcp](https://github.com/needsupport/chrome-control-mcp) project, providing efficient web browsing capabilities for AI assistants without relying on screenshots.

## Project Overview

The Chrome Control MCP (Model Context Protocol) server enables AI assistants to interact with web pages in a more efficient and semantic manner compared to traditional screenshot-based approaches. By directly analyzing the DOM (Document Object Model), it provides a rich understanding of web page structure and content.

## Key Features

- **DOM Mutation Observers** - Real-time updates for dynamic content changes
- **Semantic DOM Analysis** - Deep understanding of page structure and content
- **Content Extraction** - Extracts structured content from web pages
- **Form Handling** - Identifies and interacts with forms accurately
- **Navigation Management** - Handles complex navigation scenarios reliably
- **Error Recovery** - Sophisticated error handling with recovery strategies

## Architecture

The implementation follows a modular architecture with these key components:

1. **Chrome MCP Server** - Handles incoming requests from AI assistants
2. **Chrome API Wrapper** - Provides a clean interface to Chrome DevTools Protocol
3. **DOM Interaction Layer** - Executes actions like clicking, typing, and scrolling
4. **Semantic Analyzer** - Builds semantic representation of pages
5. **Content Extractor** - Extracts structured content from pages
6. **Navigation Manager** - Handles complex navigation scenarios
7. **Form Handler** - Identifies and interacts with forms
8. **Error Handler** - Provides consistent error reporting
9. **Cache System** - Optimizes performance through intelligent caching
10. **Logging System** - Records detailed operation logs

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

## Usage

The server provides a JSON-RPC API that can be accessed at `http://localhost:3001`. Here's a basic example:

```javascript
// Navigate to a URL
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
  console.log(`Page loaded in tab: ${tabId}`);
});
```

See the `examples` directory for more detailed usage examples.

## Examples

- **analyze-page.ts** - Demonstrates how to analyze a web page's structure
- **search-and-extract.ts** - Shows how to perform a search and extract content

Run examples with:

```bash
npx ts-node examples/analyze-page.ts https://example.com
```

## Implementation Status

This implementation follows the roadmap outlined in the [chrome-control-mcp](https://github.com/needsupport/chrome-control-mcp) project, with a focus on modular architecture and small, interconnected components.

- [x] Basic server structure
- [x] Chrome API wrapper
- [x] DOM interaction layer
- [x] Semantic analyzer
- [x] Content extractor
- [x] Navigation manager
- [x] Form handler
- [x] Error handling
- [x] Cache system
- [x] Logging system
- [ ] Comprehensive test suite
- [ ] Documentation

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT
