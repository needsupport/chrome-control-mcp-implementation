#!/bin/bash

# Start Chrome Control MCP Server
# Enhanced script that leverages the improved Chrome Process Manager

# Set execute permissions for this script
chmod +x "$0"

# Configuration with defaults (can be overridden with environment variables)
export PORT=${PORT:-3001}
export CHROME_DEBUGGING_PORT=${CHROME_DEBUGGING_PORT:-9222}
export NODE_ENV=${NODE_ENV:-development}
export LOG_LEVEL=${LOG_LEVEL:-info}
export MANAGE_CHROME_PROCESS=${MANAGE_CHROME_PROCESS:-true}
export CHROME_TEMP_USER_DATA_DIR=${CHROME_TEMP_USER_DATA_DIR:-true}

# Log functions
log_info() { echo -e "\e[34m[INFO]\e[0m $1"; }
log_success() { echo -e "\e[32m[SUCCESS]\e[0m $1"; }
log_warning() { echo -e "\e[33m[WARNING]\e[0m $1"; }
log_error() { echo -e "\e[31m[ERROR]\e[0m $1"; }

# Check node version
node_version=$(node -v 2>/dev/null || echo "")
if [[ -z "$node_version" ]]; then
  log_error "Node.js is not installed or not in PATH"
  log_info "Please install Node.js from https://nodejs.org/"
  exit 1
fi

log_info "Node.js version: $node_version"

# Detect platform
if [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="macOS"
  # Try to find Chrome on macOS
  if [[ -z "$CHROME_EXECUTABLE" ]]; then
    if [[ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
      export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    elif [[ -f "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
      export CHROME_EXECUTABLE="$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    fi
  fi
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  PLATFORM="Windows"
  # Try to find Chrome on Windows
  if [[ -z "$CHROME_EXECUTABLE" ]]; then
    if [[ -f "C:\Program Files\Google\Chrome\Application\chrome.exe" ]]; then
      export CHROME_EXECUTABLE="C:\Program Files\Google\Chrome\Application\chrome.exe"
    elif [[ -f "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" ]]; then
      export CHROME_EXECUTABLE="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    fi
  fi
else
  PLATFORM="Linux"
  # Try to find Chrome on Linux
  if [[ -z "$CHROME_EXECUTABLE" ]]; then
    for chrome_path in "/usr/bin/google-chrome" "/usr/bin/google-chrome-stable" "/usr/bin/chromium" "/usr/bin/chromium-browser"; do
      if [[ -f "$chrome_path" ]]; then
        export CHROME_EXECUTABLE="$chrome_path"
        break
      fi
    done
  fi
fi

if [[ -z "$CHROME_EXECUTABLE" ]]; then
  log_warning "Chrome executable not specified and could not be automatically detected"
  log_info "The server will attempt to find Chrome at runtime"
else
  log_info "Using Chrome executable: $CHROME_EXECUTABLE"
fi

# Check if necessary directories exist
if [ ! -d "node_modules" ]; then
  log_info "Installing dependencies..."
  
  # Check for package-lock.json to determine if we should use npm ci or npm install
  if [ -f "package-lock.json" ]; then
    npm ci || npm install
  else
    npm install
  fi
  
  if [ $? -ne 0 ]; then
    log_error "Failed to install dependencies"
    exit 1
  fi
fi

# Check if dist directory exists, if not, build
if [ ! -d "dist" ] || [ ! -f "dist/index.js" ]; then
  log_info "Building TypeScript code..."
  npm run build
  
  if [ $? -ne 0 ]; then
    log_error "Build failed"
    exit 1
  fi
  
  log_success "Build completed successfully"
else
  log_info "Using existing build"
fi

# Create data directory if it doesn't exist
if [ ! -d "data" ]; then
  mkdir -p data
  log_info "Created data directory"
fi

# Create logs directory if it doesn't exist
if [ ! -d "logs" ]; then
  mkdir -p logs
  log_info "Created logs directory"
fi

# Set environment variables for the server
# These use the improved Chrome Process Manager functionality
export MANAGE_CHROME_PROCESS=true
export CHROME_HEALTH_CHECK_INTERVAL=5000
export CHROME_MAX_CPU_USAGE=90
export CHROME_MAX_MEMORY_USAGE=2000
export CHROME_RESTART_ATTEMPTS=5
export CHROME_RESTART_BACKOFF=1000
export ENABLE_CONNECTION_RECOVERY=true
export GRACEFUL_SHUTDOWN_TIMEOUT=10000

# For development, we start Chrome in non-headless mode
if [[ "$NODE_ENV" == "development" ]]; then
  export CHROME_HEADLESS=false
  log_info "Starting in development mode (non-headless Chrome)"
else
  export CHROME_HEADLESS=true
  log_info "Starting in production mode (headless Chrome)"
fi

# Additional Chrome flags for better performance
export CHROME_ADDITIONAL_FLAGS="--disable-features=IsolateOrigins,site-per-process,TranslateUI,BlinkGenPropertyTrees --disable-blink-features=AutomationControlled --hide-scrollbars --disable-speech-api --mute-audio --ignore-certificate-errors --disable-notifications"

# Start the server with potential recovery
MAX_RETRIES=3
RETRY_COUNT=0

# Trap SIGINT and SIGTERM for graceful shutdown
trap_handler() {
  log_info "Shutting down Chrome MCP server..."
  exit 0
}

trap trap_handler SIGINT SIGTERM

start_server() {
  log_info "Starting Chrome Control MCP server..."
  log_info "Server port: $PORT | Chrome debugging port: $CHROME_DEBUGGING_PORT"

  node dist/index.js
  RESULT=$?
  
  if [ $RESULT -ne 0 ]; then
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
      RETRY_COUNT=$((RETRY_COUNT + 1))
      DELAY=$((2 ** RETRY_COUNT))
      log_warning "Server exited with code $RESULT. Retrying in $DELAY seconds... (attempt $RETRY_COUNT of $MAX_RETRIES)"
      sleep $DELAY
      start_server
    else
      log_error "Server failed to start after $MAX_RETRIES attempts"
      exit 1
    fi
  fi
}

# Start the server
start_server
