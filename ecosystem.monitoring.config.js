module.exports = {
  apps: [
    {
      name: 'storage-monitor',
      script: './scripts/monitor-storage.js',
      instances: 1,
      autorestart: false, // Don't restart after completion
      cron_restart: '0 0 * * *', // Run daily at midnight
      watch: false,
      max_memory_restart: '100M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/storage-monitor-error.log',
      out_file: './logs/storage-monitor-out.log',
      time: true,
    },
  ],
};
