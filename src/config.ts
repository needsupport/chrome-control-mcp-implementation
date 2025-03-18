/**
 * Configuration settings for the Chrome Control MCP server
 */

// Get environment variables with defaults
const getEnvVar = (name: string, defaultValue: string): string => 
  process.env[name] || defaultValue;

const getEnvVarBool = (name: string, defaultValue: boolean): boolean => 
  process.env[name] ? process.env[name]?.toLowerCase() === 'true' : defaultValue;

const getEnvVarNum = (name: string, defaultValue: number): number => {
  const value = process.env[name];
  return value ? parseInt(value, 10) : defaultValue;
};

const getEnvVarArray = (name: string, defaultValue: string[] = []): string[] => {
  const value = process.env[name];
  return value ? value.split(',').map(item => item.trim()) : defaultValue;
};

export const config = {
  // Server configuration
  serverPort: getEnvVarNum('PORT', 3001),
  
  // Chrome configuration
  chromeDebuggingPort: getEnvVarNum('CHROME_DEBUGGING_PORT', 9222),
  connectionTimeout: getEnvVarNum('CONNECTION_TIMEOUT', 30000), // 30 seconds
  navigationTimeout: getEnvVarNum('NAVIGATION_TIMEOUT', 30000), // 30 seconds
  
  // Cache configuration
  cacheTTL: getEnvVarNum('CACHE_TTL', 10), // 10 seconds
  maxCacheSize: getEnvVarNum('MAX_CACHE_SIZE', 200), // Max number of entries
  cacheEnabled: getEnvVarBool('CACHE_ENABLED', true),
  
  // Logging configuration
  debugMode: getEnvVarBool('DEBUG', false),
  logLevel: getEnvVar('LOG_LEVEL', 'info'),
  logDirectory: getEnvVar('LOG_DIR', './logs'),
  
  // DOM interaction configuration
  domPollingInterval: getEnvVarNum('DOM_POLLING_INTERVAL', 100), // milliseconds
  maxRetries: getEnvVarNum('MAX_RETRIES', 3),
  
  // Content analysis settings
  maxContentLength: getEnvVarNum('MAX_CONTENT_LENGTH', 1000000), // 1MB
  contentChunkSize: getEnvVarNum('CONTENT_CHUNK_SIZE', 100000), // 100KB
  
  // Feature flags
  enableMutationObserver: getEnvVarBool('ENABLE_MUTATION_OBSERVER', true),
  enablePerformanceMetrics: getEnvVarBool('ENABLE_PERFORMANCE_METRICS', true),
  enableMlSemanticAnalysis: getEnvVarBool('ENABLE_ML_SEMANTIC_ANALYSIS', false), // Disabled by default
  enableAccessibilityTree: getEnvVarBool('ENABLE_ACCESSIBILITY_TREE', true),
  enableCrossOriginHandling: getEnvVarBool('ENABLE_CROSS_ORIGIN_HANDLING', true),
  enableContentEmbeddings: getEnvVarBool('ENABLE_CONTENT_EMBEDDINGS', false), // Disabled by default
  
  // Authentication configuration
  authEnabled: getEnvVarBool('AUTH_ENABLED', false),
  apiKeys: getEnvVarArray('API_KEYS'),
  generateApiKeyOnStartup: getEnvVarBool('GENERATE_API_KEY_ON_STARTUP', true),
  
  // Rate limiting configuration
  rateLimitEnabled: getEnvVarBool('RATE_LIMIT_ENABLED', false),
  rateLimitRequests: getEnvVarNum('RATE_LIMIT_REQUESTS', 100), // requests per window
  rateLimitWindow: getEnvVarNum('RATE_LIMIT_WINDOW', 60000), // 1 minute window
  
  // Request validation
  maxRequestSize: getEnvVarNum('MAX_REQUEST_SIZE', 1048576), // 1MB
  requestTimeout: getEnvVarNum('REQUEST_TIMEOUT', 60000), // 60 seconds
  
  // Proxy configuration (for accessing sites through a proxy)
  proxyEnabled: getEnvVarBool('PROXY_ENABLED', false),
  proxyUrl: getEnvVar('PROXY_URL', ''),
  
  // Security settings
  sandboxJavaScript: getEnvVarBool('SANDBOX_JAVASCRIPT', true),
  allowedOrigins: getEnvVarArray('ALLOWED_ORIGINS', ['*']),
  
  // Monitoring and debugging
  healthcheckEnabled: getEnvVarBool('HEALTHCHECK_ENABLED', true),
  healthcheckPath: getEnvVar('HEALTHCHECK_PATH', '/health'),
  metricsEnabled: getEnvVarBool('METRICS_ENABLED', false),
  metricsPath: getEnvVar('METRICS_PATH', '/metrics')
};
