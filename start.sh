#!/bin/bash

# Yearn Pricing Service Startup Script

echo "Starting Yearn Pricing Service..."

# Check if .env file exists, if not copy from example
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build the TypeScript code
echo "Building TypeScript..."
npm run build

# Create data directory for cache persistence
mkdir -p data

# Start the service
echo "Starting service on port ${PORT:-8080}..."
npm start