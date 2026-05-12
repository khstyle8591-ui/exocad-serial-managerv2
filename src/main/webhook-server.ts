import http from 'http';
import { logger } from './utils/logger';

type WebhookStatus = {
  running: boolean;
  port: number;
};

let server: http.Server | null = null;
let activePort = Number(process.env.WEBHOOK_PORT) || 3000;

function buildHandler(): http.RequestListener {
  return (req, res) => {
    if (!req.url) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Missing request URL' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port: activePort }));
      return;
    }

    if (req.method === 'POST' && req.url === '/') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        logger.info(`Webhook payload received (${body.length} bytes)`);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not found' }));
  };
}

export function getWebhookStatus(): WebhookStatus {
  return {
    running: server !== null && server.listening,
    port: activePort,
  };
}

export async function startWebhookServer(port = activePort): Promise<WebhookStatus> {
  if (server?.listening) {
    if (activePort !== port) {
      throw new Error(`Webhook server already running on port ${activePort}`);
    }
    return getWebhookStatus();
  }

  activePort = port;
  const nextServer = http.createServer(buildHandler());

  await new Promise<void>((resolve, reject) => {
    nextServer.once('error', reject);
    nextServer.listen(activePort, '127.0.0.1', () => {
      nextServer.removeListener('error', reject);
      resolve();
    });
  });

  server = nextServer;
  logger.info(`Webhook server started on port ${activePort}`);
  return getWebhookStatus();
}

export async function stopWebhookServer(): Promise<WebhookStatus> {
  if (!server) {
    return getWebhookStatus();
  }

  const closingServer = server;
  server = null;

  await new Promise<void>((resolve, reject) => {
    closingServer.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  logger.info(`Webhook server stopped on port ${activePort}`);
  return getWebhookStatus();
}
