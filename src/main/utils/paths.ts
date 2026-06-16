import path from 'path';

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
export const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
export const SCREENSHOT_DIR = path.join(DATA_DIR, 'screenshots');
