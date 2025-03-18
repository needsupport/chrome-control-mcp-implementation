/**
 * Configuration settings for the Chrome Control MCP server
 */

export const config = {
  // Server configuration
  serverPort: process.env.PORT ? parseInt(process.env.PORT) : 3001,
  
  // Chrome configuration
  chromeDebuggingPort: 9222,
  connectionTimeout: 30000, // 30 seconds
  navigationTimeout: 30000, // 30 seconds
  
  // Cache configuration
  cacheTTL: 10, // 10 seconds
  maxCacheSize: 200, // Max number of entries
  cacheEnabled: true,
  
  // Logging configuration
  debugMode: process.env.DEBUG === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  logDirectory: './logs',
  
  // DOM interaction configuration
  domPollingInterval: 100, // milliseconds
  maxRetries: 3,
  
  // Content analysis settings
  maxContentLength: 1000000, // 1MB
  contentChunkSize: 100000, // 100KB
  
  // Feature flags
  enableMutationObserver: true,
  enablePerformanceMetrics: true,
  enableMlSemanticAnalysis: false, // Disabled by default until fully implemented
  enableAccessibilityTree: true,
  enableCrossOriginHandling: true,
  enableContentEmbeddings: false // Disabled by default as it requires ML models
};