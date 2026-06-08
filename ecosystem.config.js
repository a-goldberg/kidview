module.exports = {
  apps: [
    {
      name: 'kidview',
      script: './server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: 3002,
        DATABASE_PATH: './data/kidview.sqlite'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      time: true,
      max_memory_restart: '300M'
    }
  ]
};
