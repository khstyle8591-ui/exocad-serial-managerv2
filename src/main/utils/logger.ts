import fs from 'fs';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { LOG_DIR } from './paths';

class Logger {
  private logger: winston.Logger | null = null;

  init(): void {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new DailyRotateFile({
          dirname: LOG_DIR,
          filename: '%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxFiles: process.env.LOG_MAX_FILES || '14d',
          maxSize: process.env.LOG_MAX_SIZE || '100m',
          zippedArchive: false,
        }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(info => `[${info.timestamp}] [${String(info.level).toUpperCase()}] ${info.message}`)
          ),
        }),
      ],
    });
  }

  private write(level: 'info' | 'warn' | 'error', message: string): void {
    if (!this.logger) this.init();
    this.logger?.[level](message);
  }

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string): void {
    this.write('error', message);
  }
}

export const logger = new Logger();
