# Changelog

All notable changes to the Chrome Control MCP Implementation will be documented in this file.

## [Unreleased]

### Added
- Complete Chrome Process Manager implementation
- Robust crash detection and automatic recovery
- Process health monitoring with automatic restart
- Event system for process lifecycle (start, stop, crash, restart)
- Temporary directory cleanup and resource management
- Performance optimizations for local deployment
- Example scripts for common local use cases
- Comprehensive accessibility tree support with issue detection
- Basic test suite for Chrome Process Manager and accessibility tree

### Changed
- Updated roadmap with focus on local deployment
- Enhanced startup script to detect and use locally available Chrome
- Improved graceful shutdown with proper cleanup of all resources
- Optimized local performance for reduced overhead
- Updated documentation for local deployment scenarios
- Added accessibility tree API endpoint and documentation

### Fixed
- Chrome process management in startup script
- Resource cleanup during graceful shutdown
- Improved error handling with local environment focus
- Tab management race conditions
- Process resources memory leaks
- Fixed missing retry function implementation
- Added proper error handling for accessibility tree extraction

## [Previously Added]
- Automated Chrome process management in startup script
- Connection retry logic for Chrome CDP
- Enhanced error recovery for lost connections
- Port conflict handling logic
- Mutex-based locking for race condition fixes
- Proper cleanup for memory leak prevention
- LRU cache and optimized DOM handling for performance improvements
- Enhanced semantic analysis with importance calculation
- Global error handlers for better error handling
- Input validation and timeout protection for security improvements
- Timeout protection for long-running operations
- CHANGELOG.md to track changes

## [Previously Changed]
- Enhanced startup script to automatically launch Chrome with proper debugging flags
- Updated dependency handling logic
- Enhanced session recovery for disconnections
- Improved synchronization for concurrent tab operations
- Updated startup script to point to `dist/index.js` instead of `dist/server/start-mcp-server.js`
- Improved documentation with details about new features
- Enhanced Implementation Status section with recent improvements

## [Previously Fixed]
- Connection handling and reconnection logic
- Race conditions in tab management and DOM observation
- Memory leaks in DOM observers and Chrome resources
- Improved error recovery in critical operations
- Session tracking and cleanup
- Build process handling in startup script

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
