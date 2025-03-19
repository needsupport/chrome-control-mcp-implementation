#!/bin/bash

# Chrome Control MCP Server - Startup Script
# Handles the setup, build and startup of the MCP server

set -e  # Exit on error

# Set execute permissions for this script if not already set
chmod +x "$0"

# Configuration (can be overridden with environment variables)
SERVER_PORT=${PORT:-3001}
CHROME_DEBUG_PORT=${CHROME_DEBUGGING_PORT:-9222}
NODE_ENV=${NODE_ENV:-development}
LOG_LEVEL=${LOG_LEVEL:-info}
MANAGE_CHROME=${MANAGE_CHROME_PROCESS:-true}
HEALTH_CHECK_PATH=${HEALTHCHECK_PATH:-/health}
BUILD_FIRST=${BUILD_FIRST:-true}

# Log functions with timestamps
log_info() { echo -e "\e[34m[$(date '+%Y-%m-%d %H:%M:%S')] [INFO]\e[0m $1"; }
log_success() { echo -e "\e[32m[$(date '+%Y-%m-%d %H:%M:%S')] [SUCCESS]\e[0m $1"; }
log_warning() { echo -e "\e[33m[$(date '+%Y-%m-%d %H:%M:%S')] [WARNING]\e[0m $1"; }
log_error() { echo -e "\e[31m[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR]\e[0m $1"; }

# Print banner
echo -e "\e[36m"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                  Chrome Control MCP Server                     ║" 
echo "║                                                               ║"
echo "║  Efficient web browsing capabilities for AI assistants        ║"
echo "║  without relying on screenshots                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "\e[0m"

# Setup cleanup function to ensure proper shutdown
cleanup() {
  log_info "Shutting down gracefully..."
  
  # Check if a server PID file exists and kill the process
  if [[ -f ".server.pid" ]]; then
    SERVER_PID=$(cat .server.pid)
    if ps -p "$SERVER_PID" > /dev/null; then
      log_info "Stopping server process (PID: $SERVER_PID)"
      kill "$SERVER_PID" 2>/dev/null || true
    fi
    rm -f .server.pid
  fi
  
  log_info "Cleanup complete"
}

# Register cleanup on exit
trap cleanup EXIT INT TERM

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    log_info "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Print Node.js information
NODE_VERSION=$(node -v)
log_info "Using Node.js $NODE_VERSION"

# Check if necessary directories exist and install dependencies if needed
if [ ! -d "node_modules" ]; then
    log_info "Installing dependencies..."
    
    if command -v npm &> /dev/null; then
        npm ci || npm install
    else
        log_error "npm is not available"
        exit 1
    fi
fi

# Build TypeScript code if needed
if [ "$BUILD_FIRST" == "true" ]; then
    log_info "Building TypeScript code..."
    npm run build || { 
        log_error "Build failed"
        exit 1
    }
    log_success "Build completed successfully"
fi

# Define environment variables for the server
export PORT=$SERVER_PORT
export CHROME_DEBUGGING_PORT=$CHROME_DEBUG_PORT
export MANAGE_CHROME_PROCESS=$MANAGE_CHROME
export LOG_LEVEL=$LOG_LEVEL
export NODE_ENV=$NODE_ENV

# Start the server
log_info "Starting Chrome Control MCP server on port $SERVER_PORT..."
log_info "Chrome Process Management: $MANAGE_CHROME"

# Check if running in development mode
if [ "$NODE_ENV" == "development" ]; then
    log_info "Running in development mode with live code reload"
    npx ts-node-esm src/index.ts &
else
    log_info "Running in production mode"
    node dist/index.js &
fi

# Save the server PID
SERVER_PID=$!
echo $SERVER_PID > .server.pid
log_info "Server started with PID: $SERVER_PID"

# Wait for the server to start
log_info "Waiting for server to start..."
MAX_RETRIES=10
RETRY_DELAY=1
started=false

for i in $(seq 1 $MAX_RETRIES); do
    if curl -s "http://localhost:$SERVER_PORT$HEALTH_CHECK_PATH" > /dev/null; then
        started=true
        break
    fi
    log_info "Waiting for server to start (attempt $i of $MAX_RETRIES)..."
    sleep $RETRY_DELAY
done

if [ "$started" = true ]; then
    log_success "Chrome Control MCP server started successfully"
    log_info "Server: http://localhost:$SERVER_PORT"
    log_info "Health check: http://localhost:$SERVER_PORT$HEALTH_CHECK_PATH"
    log_info "Chrome debug: http://localhost:$CHROME_DEBUG_PORT"
    
    # Wait for the server process to finish
    wait $SERVER_PID
else
    log_error "Server failed to start after $MAX_RETRIES attempts"
    exit 1
fi
