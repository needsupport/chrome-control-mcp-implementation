/**
 * Chrome Control MCP Server
 * Handles incoming JSON-RPC requests and routes them to the appropriate components
 */

import http from 'http';
import { URL } from 'url';
import { JsonRpcRequest, JsonRpcResponse } from '../types.js';
import { ChromeAPI } from '../chrome/chrome-api.js';
import { Logger } from '../logging/logger.js';

// Initialize components
const logger = new Logger('server');
const chromeAPI = new ChromeAPI();

/**
 * Start the MCP server on the specified port
 */
export function startServer(port: number): http.Server {
  const server = http.createServer(handleRequest);
  
  server.listen(port, () => {
    logger.info(`Chrome Control MCP server started on port ${port}`);
  });
  
  // Handle server errors
  server.on('error', (error) => {
    logger.error('Server error', error);
  });
  
  return server;
}

/**
 * Handle incoming HTTP requests
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
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
  
  try {
    // Parse the request body
    const body = await parseRequestBody(req);
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
    // Handle parsing errors
    logger.error('Request processing error', error);
    
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
}

/**
 * Parse the request body from the HTTP request
 */
function parseRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
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