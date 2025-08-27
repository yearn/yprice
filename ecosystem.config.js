module.exports = {
  apps: [
    {
      name: 'yearn-pricing',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8080,
        CACHE_TTL_SECONDS: 60,
        RATE_LIMIT_WINDOW_MS: 60000,
        RATE_LIMIT_MAX_REQUESTS: 100,
        LOG_LEVEL: 'info'
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true
    }
  ]
};