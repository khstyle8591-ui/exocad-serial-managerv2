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
            },
            watch: false,
            autorestart: true,
            max_restarts: 10,
            restart_delay: 3000,
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            // Playwright(Chromium) 실행 시 메모리 급증 대비
            // 700MB 초과 시 자동 재시작 (GCP e2-micro 1GB 기준)
            max_memory_restart: '700M',
            // Node.js 힙 메모리 상한 설정 (기본 512MB → 512MB로 유지 + Chromium 여유분)
            node_args: '--max-old-space-size=512',
        },
    ],
};
