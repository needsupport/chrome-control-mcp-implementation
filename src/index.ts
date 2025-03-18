// Chrome Control MCP Implementation - Main Entry Point
import { startServer } from './server/server.js';
import { config } from './config.js';

// Start the MCP server
startServer(config.serverPort);

console.log(`Chrome Control MCP server starting on port ${config.serverPort}...`);