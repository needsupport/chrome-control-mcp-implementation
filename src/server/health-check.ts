/**
 * Health Check Component
 * 
 * Provides health check endpoints and system monitoring for the MCP Server
 */

import http from 'http';
import os from 'os';
import { URL } from 'url';
import { config } from '../config.js';
import { Logger } from '../logging/logger.js';
import { chromeProcessManager } from '../index.js';

const logger = new Logger('health-check');

/**
 * Health status of the system components
 */
interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  components: {
    chrome: {
      status: 'ok' | 'degraded' | 'error';
      details: {
        pid?: number;
        debugPort?: number;
        uptime?: number;
        resourceUsage?: {
          cpu?: number;
          memory?: number;
        };
        crashCount?: number;
      };
    };
    server: {
      status: 'ok';
      details: {
        uptime: number;
        port: number;
        nodeVersion: string;
        platform: string;
        memoryUsage: {
          rss: number;
          heapTotal: number;
          heapUsed: number;
          external: number;
        };
        cpuUsage: {
          user: number;
          system: number;
        };
        loadAverage: number[];
      };
    };
  };
  timestamp: number;
  version: string;
}

/**
 * Get the server health status
 */
export function getHealthStatus(): HealthStatus {
  // Get Chrome process health
  const chromeStatus = getChromeHealth();
  
  // Get server health
  const serverStatus = getServerHealth();
  
  // Overall system status is determined by component statuses
  const overallStatus = chromeStatus.status === 'error' ? 'error' : 
                      chromeStatus.status === 'degraded' ? 'degraded' : 'ok';
  
  // Combine all information
  return {
    status: overallStatus,
    components: {
      chrome: chromeStatus,
      server: serverStatus
    },
    timestamp: Date.now(),
    version: config.version || '1.0.0'
  };
}

/**
 * Get Chrome process health
 */
function getChromeHealth(): {
  status: 'ok' | 'degraded' | 'error';
  details: {
    pid?: number;
    debugPort?: number;
    uptime?: number;
    resourceUsage?: {
      cpu?: number;
      memory?: number;
    };
    crashCount?: number;
  };
} {
  // Default to error status if Chrome Process Manager is not available
  if (!chromeProcessManager) {
    return {
      status: config.manageChromeProcess ? 'error' : 'ok', // Only error if supposed to manage Chrome
      details: {
        // No details available
      }
    };
  }
  
  const info = chromeProcessManager.processInfo;
  
  // If Chrome is not running, return error
  if (!info) {
    return {
      status: 'error',
      details: {
        crashCount: chromeProcessManager.getCrashStatistics().count
      }
    };
  }
  
  // Resource usage warnings
  let status: 'ok' | 'degraded' | 'error' = 'ok';
  
  // Check resource usage thresholds if available
  if (info.resourceUsage) {
    if (info.resourceUsage.cpu > config.chromeMaxCpuUsage || 
        info.resourceUsage.memory > config.chromeMaxMemoryUsage) {
      status = 'degraded';
    }
  }
  
  // Calculate uptime
  const uptime = info.startTime ? (Date.now() - info.startTime) / 1000 : undefined;
  
  // Return Chrome health status
  return {
    status,
    details: {
      pid: info.pid,
      debugPort: info.debugPort,
      uptime,
      resourceUsage: info.resourceUsage ? {
        cpu: info.resourceUsage.cpu,
        memory: info.resourceUsage.memory
      } : undefined,
      crashCount: chromeProcessManager.getCrashStatistics().count
    }
  };
}

/**
 * Get server health
 */
function getServerHealth(): {
  status: 'ok';
  details: {
    uptime: number;
    port: number;
    nodeVersion: string;
    platform: string;
    memoryUsage: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
    cpuUsage: {
      user: number;
      system: number;
    };
    loadAverage: number[];
  };
} {
  // Get memory usage in MB
  const memUsage = process.memoryUsage();
  const memoryUsage = {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024)
  };
  
  // Get CPU usage
  const cpuUsage = process.cpuUsage();
  const cpuUsageNormalized = {
    user: Math.round(cpuUsage.user / 1000), // microseconds to milliseconds
    system: Math.round(cpuUsage.system / 1000) // microseconds to milliseconds
  };
  
  // Get load average (may not be available on all platforms)
  const loadAverage = os.loadavg();
  
  return {
    status: 'ok',
    details: {
      uptime: Math.round(process.uptime()),
      port: config.serverPort,
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      memoryUsage,
      cpuUsage: cpuUsageNormalized,
      loadAverage
    }
  };
}

/**
 * Handle health check requests
 */
export function handleHealthCheck(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!req.url) return false;
  
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  
  // Basic health check endpoint
  if (parsedUrl.pathname === config.healthcheckPath && req.method === 'GET') {
    const healthStatus = getHealthStatus();
    
    // Set response headers
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    // Send response
    res.end(JSON.stringify(healthStatus));
    return true;
  }
  
  // Detailed health check (includes all components and metrics)
  if (parsedUrl.pathname === `${config.healthcheckPath}/details` && req.method === 'GET') {
    const healthStatus = getHealthStatus();
    
    // Additional system info for detailed health check
    const details = {
      ...healthStatus,
      system: {
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalmem: Math.round(os.totalmem() / 1024 / 1024), // MB
        freemem: Math.round(os.freemem() / 1024 / 1024), // MB
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        uptime: Math.round(os.uptime())
      },
      configuration: {
        // Include non-sensitive configuration for debugging
        serverPort: config.serverPort,
        chromeDebuggingPort: config.chromeDebuggingPort,
        debugMode: config.debugMode,
        logLevel: config.logLevel,
        manageChromeProcess: config.manageChromeProcess,
        cacheEnabled: config.cacheEnabled,
        authEnabled: config.authEnabled,
        rateLimitEnabled: config.rateLimitEnabled
      }
    };
    
    // Set response headers
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    // Send response
    res.end(JSON.stringify(details));
    return true;
  }
  
  // Chrome status check (specific to Chrome)
  if (parsedUrl.pathname === `${config.healthcheckPath}/chrome` && req.method === 'GET') {
    const chromeStatus = getChromeHealth();
    
    // Set response headers
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    // Send response
    res.end(JSON.stringify({
      chrome: chromeStatus,
      timestamp: Date.now()
    }));
    return true;
  }
  
  // Liveness probe - simple endpoint for basic health check
  if (parsedUrl.pathname === '/livez' && req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok' }));
    return true;
  }
  
  // Readiness probe - more comprehensive check
  if (parsedUrl.pathname === '/readyz' && req.method === 'GET') {
    const health = getHealthStatus();
    
    // Set status code based on overall health
    res.statusCode = health.status === 'ok' ? 200 : 
                    health.status === 'degraded' ? 200 : 503;
    
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ 
      status: health.status,
      chrome: health.components.chrome.status === 'ok'
    }));
    return true;
  }
  
  return false;
}
