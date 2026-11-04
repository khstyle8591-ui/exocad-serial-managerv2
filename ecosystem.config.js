// Cloudflare Tunnel 모드 — HTTPS는 Cloudflare가 처리하므로 포트 80/443 불필요.
// 시작 전 .env 파일에 아래 시크릿을 설정해야 합니다:
//   API_USER, API_PASSWORD_HASH, DB_PATH, PORTAL_BASE_URL,
//   POP3_PASSWORD, IMAP_PASSWORD, SMTP_PASSWORD, EXOCAD_PASSWORD,
//   SLACK_WEBHOOK_URL, SLACK_WEBHOOK_URL_RELATED
module.exports = {
    apps: [
        {
            name: 'exocad-serial',
            script: 'dist/main/main/server.js',
            cwd: __dirname,
            env: {
                NODE_ENV: 'production',
                HTTP_PORT: 3000,
                BIND_HOST: '127.0.0.1',        // Cloudflare Tunnel: 로컬호스트만 리슨
                ALLOWED_ORIGIN: 'https://exocadai.geomedi.co.jp',
                PORTAL_BASE_URL: 'https://exocadai.geomedi.co.jp',
                DB_PATH: '/home/geomedipm/exocad-serial/data/exocad.db',
                DATA_DIR: '/home/geomedipm/exocad-serial/data',
                LOG_DIR: '/home/geomedipm/exocad-serial/logs',
            },
            watch: false,
            autorestart: true,
            max_restarts: 10,
            restart_delay: 3000,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },
    ],
};
