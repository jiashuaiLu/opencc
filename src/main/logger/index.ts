import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export class Logger {
  private logger: winston.Logger;

  constructor() {
    const logDir = path.join(os.homedir(), '.dongcc', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const errorRotate = new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '10m',
      maxFiles: '7d',
      zippedArchive: false,
    });

    const combinedRotate = new DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: false,
    });

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        errorRotate,
        combinedRotate,
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message }) => {
              return `${timestamp} [${level}]: ${message}`;
            })
          ),
        }),
      ],
    });
  }

  setLogLevel(level: string): void {
    this.logger.level = level;
  }

  info(message: string, metadata?: any): void {
    this.logger.info(message, metadata);
  }

  warn(message: string, metadata?: any): void {
    this.logger.warn(message, metadata);
  }

  error(message: string, metadata?: any): void {
    this.logger.error(message, metadata);
  }

  debug(message: string, metadata?: any): void {
    this.logger.debug(message, metadata);
  }
}

export const logger = new Logger();
