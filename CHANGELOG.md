# Changelog

All notable changes to the Chrome Control MCP Implementation will be documented in this file.

## [Unreleased]

### Added
- Automated Chrome process management in startup script
- Connection retry logic for Chrome CDP
- Enhanced error recovery for lost connections
- Port conflict handling logic
- Improved dependency management in start-up script
- Health check endpoints for connectivity verification
- Debugging section in README.md
- WebSocket traffic monitoring utilities

### Changed
- Enhanced startup script to automatically launch Chrome with proper debugging flags
- Improved graceful shutdown with proper cleanup of all resources
- Updated dependency handling logic
- Enhanced session recovery for disconnections
- Improved synchronization for concurrent tab operations

### Fixed
- Chrome process management in startup script
- Connection handling and reconnection logic
- Resource cleanup during graceful shutdown
- Race conditions in tab management
- Session tracking and cleanup
- Build process handling in startup script

## [Previously Added]
- Mutex-based locking for race condition fixes
- Proper cleanup for memory leak prevention
- LRU cache and optimized DOM handling for performance improvements
- Enhanced semantic analysis with importance calculation
- Global error handlers for better error handling
- Input validation and timeout protection for security improvements
- Timeout protection for long-running operations
- CHANGELOG.md to track changes

## [Previously Changed]
- Updated startup script to point to `dist/index.js` instead of `dist/server/start-mcp-server.js`
- Improved documentation with details about new features
- Enhanced Implementation Status section with recent improvements

## [Previously Fixed]
- Race conditions in tab management and DOM observation
- Memory leaks in DOM observers and Chrome resources
- Improved error recovery in critical operations

## [1.0.0] - 2025-03-18

### Added
- Initial release of Chrome Control MCP Implementation
- DOM mutation observing
- Semantic DOM analysis
- Content extraction
- Form handling
- Navigation management
- Tab management
- Authentication and security
- Rate limiting
- Cache system
