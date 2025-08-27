# Deployment Guide for Yearn Pricing Service

## Running as Standalone Node.js Service

### Option 1: Direct Node.js (Simplest)

```bash
cd yearn-pricing

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Build TypeScript
npm run build

# Run the service
npm start
```

The service will run on port 8080 (or the PORT specified in .env).

### Option 2: Using the Start Script

```bash
cd yearn-pricing
./start.sh
```

This script will:
- Create .env from .env.example if needed
- Install dependencies
- Build TypeScript code
- Start the service

### Option 3: Using PM2 (Process Manager)

PM2 keeps the service running and restarts it if it crashes.

```bash
# Install PM2 globally
npm install -g pm2

cd yearn-pricing

# Install and build
npm install
npm run build

# Start with PM2
pm2 start ecosystem.config.js --env production

# View logs
pm2 logs yearn-pricing

# Stop service
pm2 stop yearn-pricing

# Restart service
pm2 restart yearn-pricing

# View status
pm2 status

# Setup PM2 to start on system boot
pm2 startup
pm2 save
```

### Option 4: Using Docker

```bash
cd yearn-pricing

# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop service
docker-compose down
```

### Option 5: Using systemd (Linux)

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/yearn-pricing.service
```

Add the following content:

```ini
[Unit]
Description=Yearn Pricing Service
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/yearn-pricing
ExecStart=/usr/bin/node /path/to/yearn-pricing/dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

Then enable and start:

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable yearn-pricing

# Start the service
sudo systemctl start yearn-pricing

# Check status
sudo systemctl status yearn-pricing

# View logs
sudo journalctl -u yearn-pricing -f
```

## Environment Configuration

Before running, configure the `.env` file:

```bash
# Server Configuration
PORT=8080
NODE_ENV=production

# API Keys (optional but recommended)
COINGECKO_API_KEY=your_key_here
DEFILLAMA_API_KEY=your_key_here

# Cache Configuration
CACHE_TTL_SECONDS=60
CACHE_CHECK_PERIOD_SECONDS=300

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
```

## Verifying the Service

Once running, test the service:

```bash
# Check health
curl http://localhost:8080/health

# Get all prices
curl http://localhost:8080/prices/all

# Get Ethereum prices
curl http://localhost:8080/prices/1

# Get a specific token price
curl http://localhost:8080/prices/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

## Production Recommendations

1. **Use PM2 or systemd** for automatic restarts and process management
2. **Configure proper API keys** for better rate limits with external services
3. **Set up log rotation** to prevent disk space issues
4. **Use a reverse proxy** (nginx/caddy) for SSL and load balancing
5. **Monitor the service** with tools like Prometheus/Grafana
6. **Regular backups** of the `data/` directory for cache persistence

## Monitoring

### With PM2:
```bash
# Real-time monitoring
pm2 monit

# Web dashboard
pm2 install pm2-web
pm2 web
```

### Health checks:
The service exposes `/health` endpoint for monitoring:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "chains": 8
}
```

## Troubleshooting

If the service doesn't start:

1. Check Node.js version (requires v18+):
   ```bash
   node --version
   ```

2. Check logs for errors:
   ```bash
   # PM2
   pm2 logs yearn-pricing --lines 100
   
   # Docker
   docker-compose logs
   
   # Systemd
   sudo journalctl -u yearn-pricing -n 100
   ```

3. Verify port availability:
   ```bash
   lsof -i :8080
   ```

4. Test build:
   ```bash
   npm run build
   ```

5. Check disk space for cache:
   ```bash
   df -h
   ```