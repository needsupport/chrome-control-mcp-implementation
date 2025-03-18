#!/bin/bash

# Start Chrome Control MCP Server

# Set execute permissions for this script if not already set
chmod +x "$0"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if necessary directories exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build TypeScript code
echo "Building TypeScript code..."
npm run build

# Start the server
echo "Starting Chrome Control MCP server..."
node dist/index.js