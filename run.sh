#!/bin/bash

# Yearn Pricing Service Runner
# Standalone TypeScript pricing service extracted from ydaemon

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Yearn Pricing Service${NC}"
echo "================================"

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js v18 or higher is required${NC}"
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file from .env.example...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env file${NC}"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
fi

# Build TypeScript
if [ ! -d "dist" ] || [ "$1" == "--build" ]; then
    echo -e "${YELLOW}Building TypeScript...${NC}"
    npm run build
    echo -e "${GREEN}✓ Build complete${NC}"
fi

# Create data directory for cache
mkdir -p data

# Start the service
echo -e "${GREEN}Starting service on port ${PORT:-8080}...${NC}"
echo "================================"
echo -e "API Endpoints:"
echo -e "  ${GREEN}Health:${NC} http://localhost:${PORT:-8080}/health"
echo -e "  ${GREEN}Docs:${NC}   http://localhost:${PORT:-8080}/"
echo -e "  ${GREEN}Prices:${NC} http://localhost:${PORT:-8080}/prices/all"
echo "================================"
echo -e "${YELLOW}Press Ctrl+C to stop${NC}\n"

# Run the service
npm start