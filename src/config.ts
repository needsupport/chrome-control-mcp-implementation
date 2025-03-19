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

// Get package version from package.json
let packageVersion = '1.0.0';
try {
  const pkg = require('../package.json');
  packageVersion = pkg.version || '1.0.0';
} catch (error) {
  // Use default version if package.json cannot be loaded
}

export const config = {
  // Version information
  version: getEnvVar('VERSION', packageVersion),
  
  // Server configuration
  serverPort: getEnvVarNum('PORT', 3001),
  autoFreeServerPort: getEnvVarBool('AUTO_FREE_SERVER_PORT', false),
  
  // Chrome process management configuration
  manageChromeProcess: getEnvVarBool('MANAGE_CHROME_PROCESS', true),
  chromeExecutablePath: getEnvVar('CHROME_EXECUTABLE', ''),
  chromeLaunchTimeout: getEnvVarNum('CHROME_LAUNCH_TIMEOUT', 30000), // 30 seconds
  chromeRestartAttempts: getEnvVarNum('CHROME_RESTART_ATTEMPTS', 5),
  chromeRestartBackoff: getEnvVarNum('CHROME_RESTART_BACKOFF', 1000), // 1 second base for exponential backoff
  chromeHealthCheckInterval: getEnvVarNum('CHROME_HEALTH_CHECK_INTERVAL', 5000), // 5 seconds
  chromeTempUserDataDir: getEnvVarBool('CHROME_TEMP_USER_DATA_DIR', true),
  chromeUserDataDir: getEnvVar('CHROME_USER_DATA_DIR', ''),
  chromeHeadless: getEnvVarBool('CHROME_HEADLESS', process.env.NODE_ENV !== 'development'),
  chromeAdditionalFlags: getEnvVarArray('CHROME_ADDITIONAL_FLAGS'),
  minChromeVersion: getEnvVarNum('MIN_CHROME_VERSION', 115),
  chromeMaxCpuUsage: getEnvVarNum('CHROME_MAX_CPU_USAGE', 80), // 80% CPU usage threshold
  chromeMaxMemoryUsage: getEnvVarNum('CHROME_MAX_MEMORY_USAGE', 2000), // 2GB memory usage threshold
  autoFreeDebugPort: getEnvVarBool('AUTO_FREE_DEBUG_PORT', false),
  
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
  logFormat: getEnvVar('LOG_FORMAT', 'json'), // 'json' or 'text'
  logRotation: getEnvVarBool('LOG_ROTATION', true),
  logMaxSize: getEnvVarNum('LOG_MAX_SIZE', 10485760), // 10MB
  logMaxFiles: getEnvVarNum('LOG_MAX_FILES', 5),
  
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
  
  // Local-focused settings
  // For local environment, default to false for authentication and security features
  authEnabled: getEnvVarBool('AUTH_ENABLED', process.env.NODE_ENV === 'production'), 
  apiKeys: getEnvVarArray('API_KEYS'),
  generateApiKeyOnStartup: getEnvVarBool('GENERATE_API_KEY_ON_STARTUP', process.env.NODE_ENV === 'production'),
  
  // Rate limiting - less strict for local environment
  rateLimitEnabled: getEnvVarBool('RATE_LIMIT_ENABLED', process.env.NODE_ENV === 'production'),
  rateLimitRequests: getEnvVarNum('RATE_LIMIT_REQUESTS', 100), // requests per window
  rateLimitWindow: getEnvVarNum('RATE_LIMIT_WINDOW', 60000), // 1 minute window
  
  // Request validation
  maxRequestSize: getEnvVarNum('MAX_REQUEST_SIZE', 1048576), // 1MB
  requestTimeout: getEnvVarNum('REQUEST_TIMEOUT', 60000), // 60 seconds
  maxConcurrentRequests: getEnvVarNum('MAX_CONCURRENT_REQUESTS', 10), // Maximum concurrent requests
  slowRequestThreshold: getEnvVarNum('SLOW_REQUEST_THRESHOLD', 5000), // 5 seconds
  
  // Proxy configuration (for accessing sites through a proxy)
  proxyEnabled: getEnvVarBool('PROXY_ENABLED', false),
  proxyUrl: getEnvVar('PROXY_URL', ''),
  
  // Security settings - less strict for local environment
  sandboxJavaScript: getEnvVarBool('SANDBOX_JAVASCRIPT', process.env.NODE_ENV === 'production'),
  allowedOrigins: getEnvVarArray('ALLOWED_ORIGINS', ['*']), // Allow all origins by default for local use
  enableCSP: getEnvVarBool('ENABLE_CSP', process.env.NODE_ENV === 'production'),
  
  // Monitoring and debugging
  healthcheckEnabled: getEnvVarBool('HEALTHCHECK_ENABLED', true),
  healthcheckPath: getEnvVar('HEALTHCHECK_PATH', '/health'),
  metricsEnabled: getEnvVarBool('METRICS_ENABLED', true),
  metricsPath: getEnvVar('METRICS_PATH', '/metrics'),
  
  // Concurrency and resource management
  gracefulShutdownTimeout: getEnvVarNum('GRACEFUL_SHUTDOWN_TIMEOUT', 10000), // 10 seconds
  tabCleanupInterval: getEnvVarNum('TAB_CLEANUP_INTERVAL', 60000), // 1 minute
  maxTabsPerInstance: getEnvVarNum('MAX_TABS_PER_INSTANCE', 50), // Maximum tabs per Chrome instance
  resourceMonitoringInterval: getEnvVarNum('RESOURCE_MONITORING_INTERVAL', 30000), // 30 seconds
  
  // Crash recovery
  startupMaxRetries: getEnvVarNum('STARTUP_MAX_RETRIES', 3),
  startupRetryDelay: getEnvVarNum('STARTUP_RETRY_DELAY', 2000), // 2 seconds
  
  // Enhanced debugging
  debugHttpTraffic: getEnvVarBool('DEBUG_HTTP_TRAFFIC', false),
  debugChromeProtocol: getEnvVarBool('DEBUG_CHROME_PROTOCOL', false),
  debugResourceUsage: getEnvVarBool('DEBUG_RESOURCE_USAGE', false),
  
  // Local storage
  localStoragePath: getEnvVar('LOCAL_STORAGE_PATH', './data'),
  enableLocalStorage: getEnvVarBool('ENABLE_LOCAL_STORAGE', true),
  
  // Health checks
  healthCheckFrequency: getEnvVarNum('HEALTH_CHECK_FREQUENCY', 30000), // 30 seconds
};
