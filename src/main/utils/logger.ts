import fs from 'fs';
import path from 'path';
import { app } from 'electron';

class Logger {
  private logDir: string = '';
  private logFile: string = '';

  init(): void {
    this.logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    this.updateLogFile();
  }

  private updateLogFile(): void {
    const date = new Date().toISOString().slice(0, 10);
    this.logFile = path.join(this.logDir, `${date}.log`);
  }

  private write(level: string, message: string): void {
    this.updateLogFile();
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}\n`;
    try {
      fs.appendFileSync(this.logFile, line);
    } catch { /* ignore */ }
    if (level === 'ERROR') {
      console.error(line.trim());
    } else {
      console.log(line.trim());
    }
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string): void {
    this.write('ERROR', message);
  }
}

export const logger = new Logger();
