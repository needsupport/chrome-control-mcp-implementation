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
  
  // Chrome process management configuration
  manageChromeProcess: getEnvVarBool('MANAGE_CHROME_PROCESS', true),
  chromeExecutablePath: getEnvVar('CHROME_EXECUTABLE', ''),
  chromeLaunchTimeout: getEnvVarNum('CHROME_LAUNCH_TIMEOUT', 30000), // 30 seconds
  chromeRestartAttempts: getEnvVarNum('CHROME_RESTART_ATTEMPTS', 3),
  chromeRestartBackoff: getEnvVarNum('CHROME_RESTART_BACKOFF', 1000), // 1 second
  chromeHealthCheckInterval: getEnvVarNum('CHROME_HEALTH_CHECK_INTERVAL', 5000), // 5 seconds
  chromeTempUserDataDir: getEnvVarBool('CHROME_TEMP_USER_DATA_DIR', true),
  chromeUserDataDir: getEnvVar('CHROME_USER_DATA_DIR', ''),
  chromeHeadless: getEnvVarBool('CHROME_HEADLESS', process.env.NODE_ENV !== 'development'),
  chromeAdditionalFlags: getEnvVarArray('CHROME_ADDITIONAL_FLAGS'),
  minChromeVersion: getEnvVarNum('MIN_CHROME_VERSION', 115),
  
  // Chrome connection configuration
  chromeDebuggingPort: getEnvVarNum('CHROME_DEBUGGING_PORT', 9222),
  connectionTimeout: getEnvVarNum('CONNECTION_TIMEOUT', 30000), // 30 seconds
  navigationTimeout: getEnvVarNum('NAVIGATION_TIMEOUT', 30000), // 30 seconds
  connectionRetryAttempts: getEnvVarNum('CONNECTION_RETRY_ATTEMPTS', 3),
  connectionRetryDelay: getEnvVarNum('CONNECTION_RETRY_DELAY', 1000), // 1 second
  
  // Cache configuration
  cacheTTL: getEnvVarNum('CACHE_TTL', 10), // 10 seconds
  maxCacheSize: getEnvVarNum('MAX_CACHE_SIZE', 200), // Max number of entries
  cacheEnabled: getEnvVarBool('CACHE_ENABLED', true),
  
  // Logging configuration
  debugMode: getEnvVarBool('DEBUG', false),
  logLevel: getEnvVar('LOG_LEVEL', 'info'),
  logDirectory: getEnvVar('LOG_DIR', './logs'),
  logChromeOutput: getEnvVarBool('LOG_CHROME_OUTPUT', false),
  
  // DOM interaction configuration
  domPollingInterval: getEnvVarNum('DOM_POLLING_INTERVAL', 100), // milliseconds
  maxRetries: getEnvVarNum('MAX_RETRIES', 3),
  mutexTimeout: getEnvVarNum('MUTEX_TIMEOUT', 10000), // 10 seconds timeout for mutex acquisition
  
  // Content analysis settings
  maxContentLength: getEnvVarNum('MAX_CONTENT_LENGTH', 1000000), // 1MB
  contentChunkSize: getEnvVarNum('CONTENT_CHUNK_SIZE', 100000), // 100KB
  maxSemanticAnalysisDepth: getEnvVarNum('MAX_SEMANTIC_ANALYSIS_DEPTH', 50), // Max depth for recursive DOM analysis
  
  // Feature flags
  enableMutationObserver: getEnvVarBool('ENABLE_MUTATION_OBSERVER', true),
  enablePerformanceMetrics: getEnvVarBool('ENABLE_PERFORMANCE_METRICS', true),
  enableMlSemanticAnalysis: getEnvVarBool('ENABLE_ML_SEMANTIC_ANALYSIS', false), // Disabled by default
  enableAccessibilityTree: getEnvVarBool('ENABLE_ACCESSIBILITY_TREE', true),
  enableCrossOriginHandling: getEnvVarBool('ENABLE_CROSS_ORIGIN_HANDLING', true),
  enableContentEmbeddings: getEnvVarBool('ENABLE_CONTENT_EMBEDDINGS', false), // Disabled by default
  enableConnectionRecovery: getEnvVarBool('ENABLE_CONNECTION_RECOVERY', true),
  
  // Authentication configuration
  authEnabled: getEnvVarBool('AUTH_ENABLED', true), // SECURITY: Enabled by default
  apiKeys: getEnvVarArray('API_KEYS'),
  generateApiKeyOnStartup: getEnvVarBool('GENERATE_API_KEY_ON_STARTUP', true),
  
  // Rate limiting configuration
  rateLimitEnabled: getEnvVarBool('RATE_LIMIT_ENABLED', true), // SECURITY: Enabled by default
  rateLimitRequests: getEnvVarNum('RATE_LIMIT_REQUESTS', 100), // requests per window
  rateLimitWindow: getEnvVarNum('RATE_LIMIT_WINDOW', 60000), // 1 minute window
  
  // Request validation
  maxRequestSize: getEnvVarNum('MAX_REQUEST_SIZE', 1048576), // 1MB
  requestTimeout: getEnvVarNum('REQUEST_TIMEOUT', 60000), // 60 seconds
  maxConcurrentRequests: getEnvVarNum('MAX_CONCURRENT_REQUESTS', 10), // Maximum concurrent requests
  
  // Proxy configuration (for accessing sites through a proxy)
  proxyEnabled: getEnvVarBool('PROXY_ENABLED', false),
  proxyUrl: getEnvVar('PROXY_URL', ''),
  
  // Security settings
  sandboxJavaScript: getEnvVarBool('SANDBOX_JAVASCRIPT', true),
  allowedOrigins: getEnvVarArray('ALLOWED_ORIGINS', []), // SECURITY: Empty by default, requiring explicit configuration
  enableCSP: getEnvVarBool('ENABLE_CSP', true), // SECURITY: Content Security Policy enabled by default
  
  // Monitoring and debugging
  healthcheckEnabled: getEnvVarBool('HEALTHCHECK_ENABLED', true),
  healthcheckPath: getEnvVar('HEALTHCHECK_PATH', '/health'),
  metricsEnabled: getEnvVarBool('METRICS_ENABLED', false),
  metricsPath: getEnvVar('METRICS_PATH', '/metrics'),
  
  // Concurrency and resource management
  gracefulShutdownTimeout: getEnvVarNum('GRACEFUL_SHUTDOWN_TIMEOUT', 10000), // 10 seconds
  tabCleanupInterval: getEnvVarNum('TAB_CLEANUP_INTERVAL', 60000), // 1 minute
  maxTabsPerInstance: getEnvVarNum('MAX_TABS_PER_INSTANCE', 50), // Maximum tabs per Chrome instance
  resourceMonitoringInterval: getEnvVarNum('RESOURCE_MONITORING_INTERVAL', 30000), // 30 seconds
};
