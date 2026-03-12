import fs from 'fs';
import path from 'path';

class Logger {
  private logDir: string = '';
  private logFile: string = '';

  init(): void {
    // 환경변수 LOG_DIR → process.cwd()/logs 순으로 폴백
    this.logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    this.updateLogFile();
  }

  private updateLogFile(): void {
    // JST (UTC+9) 기준 날짜 문자열 (YYYY-MM-DD)
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    this.logFile = path.join(this.logDir, `${date}.log`);
  }

  private write(level: string, message: string): void {
    this.updateLogFile();
    // JST (UTC+9) 기준 타임스탬프 (YYYY-MM-DD HH:mm:ss)
    const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const line = `[${timestamp}] [${level}] ${message}\n`;
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, line);
      } catch { /* ignore */ }
    }
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
