/**
 * Chrome Control MCP Server
 * Handles incoming JSON-RPC requests and routes them to the appropriate components
 */

import http from 'http';
import { URL } from 'url';
import { JsonRpcRequest, JsonRpcResponse } from '../types.js';
import { ChromeAPI } from '../chrome/chrome-api.js';
import { Logger } from '../logging/logger.js';
import { AuthManager } from './auth.js';
import { config } from '../config.js';

// Initialize components
const logger = new Logger('server');
const chromeAPI = new ChromeAPI();
const authManager = new AuthManager();

// Rate limiting data
interface RateLimitData {
  count: number;
  resetTime: number;
}
const rateLimits = new Map<string, RateLimitData>();

/**
 * Start the MCP server on the specified port
 */
export function startServer(port: number): http.Server {
  const server = http.createServer(handleRequest);
  
  server.listen(port, () => {
    logger.info(`Chrome Control MCP server started on port ${port}`);
    
    // Log authentication status
    if (authManager.isEnabled()) {
      logger.info(`API authentication enabled (${authManager.getApiKeyCount()} keys)`);
    } else {
      logger.warn('API authentication is DISABLED - consider enabling it for production use');
    }
    
    // Log rate limiting status
    if (config.rateLimitEnabled) {
      logger.info(`Rate limiting enabled: ${config.rateLimitRequests} requests per ${config.rateLimitWindow / 1000} seconds`);
    }
  });
  
  // Handle server errors
  server.on('error', (error) => {
    logger.error('Server error', error);
  });
  
  // Add health check endpoint if enabled
  if (config.healthcheckEnabled) {
    server.on('request', (req, res) => {
      if (req.url === config.healthcheckPath && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      }
    });
  }
  
  // Start clean-up timer for rate limiting
  setInterval(() => cleanupRateLimits(), 60000);
  
  return server;
}

/**
 * Handle incoming HTTP requests
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Setup timeout for the request
  const timeoutId = setTimeout(() => {
    logger.warn('Request timeout exceeded');
    res.statusCode = 408; // Request Timeout
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Request timeout exceeded'
      },
      id: null
    }));
  }, config.requestTimeout);
  
  // Clear timeout when response ends
  res.on('finish', () => {
    clearTimeout(timeoutId);
  });
  
  // Enable CORS
  const origin = req.headers.origin || '*';
  const allowedOrigins = config.allowedOrigins;
  
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin as string)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  }
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.statusCode = 204; // No Content
    res.end();
    return;
  }
  
  // Only accept POST requests
  if (req.method !== 'POST') {
    res.statusCode = 405; // Method Not Allowed
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Method not allowed. Use POST for JSON-RPC requests.'
      },
      id: null
    }));
    return;
  }
  
  // Check authentication if enabled
  if (authManager.isEnabled()) {
    const apiKey = authManager.extractApiKey(req.headers.authorization) || req.headers['x-api-key'] as string;
    
    if (!authManager.verifyApiKey(apiKey)) {
      res.statusCode = 401; // Unauthorized
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Unauthorized: Invalid or missing API key'
        },
        id: null
      }));
      return;
    }
  }
  
  // Check rate limiting if enabled
  if (config.rateLimitEnabled) {
    const clientIp = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    
    if (!checkRateLimit(clientIp)) {
      res.statusCode = 429; // Too Many Requests
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32002,
          message: 'Too many requests. Please try again later.'
        },
        id: null
      }));
      return;
    }
  }
  
  try {
    // Check request size
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    
    if (contentLength > config.maxRequestSize) {
      res.statusCode = 413; // Payload Too Large
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32003,
          message: 'Request too large'
        },
        id: null
      }));
      return;
    }
    
    // Parse the request body
    const body = await parseRequestBody(req, contentLength);
    
    try {
      const request = JSON.parse(body) as JsonRpcRequest;
      
      // Log the request
      logger.debug('Received request', { method: request.method, id: request.id });
      
      // Process the request and send response
      const response = await processRequest(request);
      
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
      
      // Log the response
      if (response.error) {
        logger.error('Request error', { method: request.method, error: response.error });
      } else {
        logger.debug('Request completed', { method: request.method, id: request.id });
      }
    } catch (error) {
      // JSON parse error
      logger.error('JSON parse error', { body: body.slice(0, 100) });
      
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: 'Parse error: Invalid JSON'
        },
        id: null
      }));
    }
  } catch (error) {
    // Request processing error
    logger.error('Request processing error', error);
    
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal error: Failed to process request'
      },
      id: null
    }));
  }
}

/**
 * Parse the request body from the HTTP request
 */
function parseRequestBody(req: http.IncomingMessage, maxLength: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    
    req.on('data', (chunk) => {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      
      // Check if the request is too large
      if (size > maxLength) {
        reject(new Error('Request body too large'));
        req.destroy(); // Terminate the connection
        return;
      }
      
      chunks.push(buffer);
    });
    
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      resolve(body);
    });
    
    req.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Process a JSON-RPC request and return a response
 */
async function processRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  // Validate JSON-RPC request
  if (request.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Invalid Request: Not a valid JSON-RPC 2.0 request'
      },
      id: request.id || null
    };
  }
  
  try {
    // Route the request to the appropriate method
    const result = await routeRequest(request.method, request.params);
    
    return {
      jsonrpc: '2.0',
      result,
      id: request.id
    };
  } catch (error) {
    // Handle method execution errors
    logger.error('Method execution error', { method: request.method, error });
    
    if (error instanceof Error) {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `Internal error: ${error.message}`
        },
        id: request.id
      };
    } else {
      return {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error'
        },
        id: request.id
      };
    }
  }
}

/**
 * Route a request to the appropriate method in the Chrome API
 */
async function routeRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  // Route to the appropriate method in the Chrome API
  switch (method) {
    // Basic methods
    case 'initialize':
      return chromeAPI.initialize();
    case 'navigate':
      return chromeAPI.navigate(params.url as string);
    case 'getContent':
      return chromeAPI.getContent(params.tabId as string);
    case 'executeScript':
      return chromeAPI.executeScript(params.tabId as string, params.script as string);
    case 'clickElement':
      return chromeAPI.clickElement(params.tabId as string, params.selector as string);
    case 'takeScreenshot':
      return chromeAPI.takeScreenshot(params.tabId as string);
    case 'closeTab':
      return chromeAPI.closeTab(params.tabId as string);
      
    // Semantic understanding methods
    case 'getStructuredContent':
      return chromeAPI.getStructuredContent(params.tabId as string);
    case 'analyzePageSemantics':
      return chromeAPI.analyzePageSemantics(params.tabId as string);
    case 'findElementsByText':
      return chromeAPI.findElementsByText(params.tabId as string, params.text as string);
    case 'findClickableElements':
      return chromeAPI.findClickableElements(params.tabId as string);
    case 'clickSemanticElement':
      return chromeAPI.clickSemanticElement(params.tabId as string, params.semanticId as string);
    case 'fillFormField':
      return chromeAPI.fillFormField(
        params.tabId as string,
        params.semanticId as string,
        params.value as string
      );
    case 'performSearch':
      return chromeAPI.performSearch(params.tabId as string, params.query as string);
      
    // Method not found
    default:
      throw new Error(`Method not found: ${method}`);
  }
}

/**
 * Check rate limit for a client
 */
function checkRateLimit(clientIp: string): boolean {
  if (!config.rateLimitEnabled) {
    return true; // Rate limiting disabled
  }
  
  const now = Date.now();
  let limit = rateLimits.get(clientIp);
  
  // Check if this is a new client or the limit has reset
  if (!limit || now > limit.resetTime) {
    limit = {
      count: 1,
      resetTime: now + config.rateLimitWindow
    };
    rateLimits.set(clientIp, limit);
    return true;
  }
  
  // Check if the client has exceeded the limit
  if (limit.count >= config.rateLimitRequests) {
    logger.warn(`Rate limit exceeded for client ${clientIp}`);
    return false;
  }
  
  // Increment the request count
  limit.count++;
  return true;
}

/**
 * Clean up expired rate limits
 */
function cleanupRateLimits(): void {
  const now = Date.now();
  let count = 0;
  
  for (const [clientIp, limit] of rateLimits.entries()) {
    if (now > limit.resetTime) {
      rateLimits.delete(clientIp);
      count++;
    }
  }
  
  if (count > 0) {
    logger.debug(`Cleaned up ${count} expired rate limits`);
  }
}
