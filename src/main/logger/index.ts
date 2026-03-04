import winston from 'winston';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { DatabaseManager } from '../database';

export class Logger {
  private logger: winston.Logger;
  private database: DatabaseManager | null = null;

  constructor() {
    const logDir = path.join(os.homedir(), '.dongcc', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log'),
        }),
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

  setDatabase(database: DatabaseManager): void {
    this.database = database;
  }

  info(message: string, metadata?: any): void {
    this.logger.info(message, metadata);
    this.saveToDatabase('info', message, metadata);
  }

  warn(message: string, metadata?: any): void {
    this.logger.warn(message, metadata);
    this.saveToDatabase('warn', message, metadata);
  }

  error(message: string, metadata?: any): void {
    this.logger.error(message, metadata);
    this.saveToDatabase('error', message, metadata);
  }

  debug(message: string, metadata?: any): void {
    this.logger.debug(message, metadata);
    this.saveToDatabase('debug', message, metadata);
  }

  private async saveToDatabase(level: string, message: string, metadata?: any): Promise<void> {
    if (!this.database) return;

    try {
      await this.database.addLog({
        id: this.generateId(),
        level,
        message,
        metadata,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Failed to save log to database:', error);
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const logger = new Logger();
