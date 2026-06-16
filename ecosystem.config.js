module.exports = {
    apps: [
        {
            name: 'exocad-serial',
            script: 'dist/main/server.js',
            cwd: __dirname,
            env: {
                NODE_ENV: 'production',
                HTTP_PORT: 80,
                HTTPS_PORT: 443,
                CERT_DOMAIN: 'geomedi-exocad.duckdns.org',
                DATA_DIR: '/home/geomedicho/exocad-serial/data',
                LOG_DIR: '/home/geomedicho/exocad-serial/logs',
            },
            watch: false,
            autorestart: true,
            max_restarts: 10,
            restart_delay: 3000,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },
    ],
};
