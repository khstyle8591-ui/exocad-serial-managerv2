module.exports = {
    apps: [
        {
            name: 'exocad-serial',
            script: 'dist/main/server.js',
            cwd: __dirname,
            env: {
                NODE_ENV: 'production',
                PORT: 3000,
            },
            watch: false,
            autorestart: true,
            max_restarts: 10,
            restart_delay: 3000,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },
    ],
};
