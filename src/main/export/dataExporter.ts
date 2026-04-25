import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

export interface ExportData {
  summary?: any;
  trends?: any[];
  modelStats?: any[];
  logs?: any[];
}

export class DataExporter {
  private exportDir: string;

  constructor() {
    this.exportDir = path.join(os.homedir(), '.opencc', 'exports');
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.exportDir)) {
      await mkdir(this.exportDir, { recursive: true });
    }
  }

  async exportToCSV(data: ExportData, filename: string): Promise<string> {
    await this.initialize();
    
    const filePath = path.join(this.exportDir, filename);
    const csvLines: string[] = [];

    if (data.summary) {
      csvLines.push('Summary');
      csvLines.push('Metric,Value');
      csvLines.push(`Total Requests,${data.summary.totalRequests || 0}`);
      csvLines.push(`Success Rate,${data.summary.successRate || 0}%`);
      csvLines.push(`Total Input Tokens,${data.summary.totalInputTokens || 0}`);
      csvLines.push(`Total Output Tokens,${data.summary.totalOutputTokens || 0}`);
      csvLines.push(`Total Tokens,${data.summary.totalTokens || 0}`);
      csvLines.push('');
    }

    if (data.trends && data.trends.length > 0) {
      csvLines.push('Usage Trends');
      csvLines.push('Date,Input Tokens,Output Tokens,Total Tokens,Requests');
      data.trends.forEach((trend) => {
        csvLines.push(
          `${trend.date},${trend.inputTokens},${trend.outputTokens},${trend.totalTokens},${trend.requests}`
        );
      });
      csvLines.push('');
    }

    if (data.modelStats && data.modelStats.length > 0) {
      csvLines.push('Model Statistics');
      csvLines.push('Model,Requests,Input Tokens,Output Tokens,Total Tokens,Success Rate');
      data.modelStats.forEach((stat) => {
        csvLines.push(
          `${stat.model},${stat.requests},${stat.inputTokens},${stat.outputTokens},${stat.totalTokens},${stat.successRate}%`
        );
      });
      csvLines.push('');
    }

    if (data.logs && data.logs.length > 0) {
      csvLines.push('Request Logs');
      csvLines.push('Timestamp,Model,Method,Status,Input Tokens,Output Tokens,Duration');
      data.logs.forEach((log) => {
        csvLines.push(
          `${log.timestamp},${log.model},${log.method},${log.status},${log.inputTokens},${log.outputTokens},${log.duration}ms`
        );
      });
    }

    await writeFile(filePath, csvLines.join('\n'), 'utf-8');
    return filePath;
  }

  async exportToExcel(data: ExportData, filename: string): Promise<string> {
    await this.initialize();
    
    const filePath = path.join(this.exportDir, filename);
    const sheets: string[] = [];

    if (data.summary) {
      sheets.push(this.createExcelSheet('Summary', [
        ['Metric', 'Value'],
        ['Total Requests', data.summary.totalRequests || 0],
        ['Success Rate', `${data.summary.successRate || 0}%`],
        ['Total Input Tokens', data.summary.totalInputTokens || 0],
        ['Total Output Tokens', data.summary.totalOutputTokens || 0],
        ['Total Tokens', data.summary.totalTokens || 0],
      ]));
    }

    if (data.trends && data.trends.length > 0) {
      const rows = [
        ['Date', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Requests'],
        ...data.trends.map((t) => [
          t.date,
          t.inputTokens,
          t.outputTokens,
          t.totalTokens,
          t.requests,
        ]),
      ];
      sheets.push(this.createExcelSheet('Trends', rows));
    }

    if (data.modelStats && data.modelStats.length > 0) {
      const rows = [
        ['Model', 'Requests', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Success Rate'],
        ...data.modelStats.map((s) => [
          s.model,
          s.requests,
          s.inputTokens,
          s.outputTokens,
          s.totalTokens,
          `${s.successRate}%`,
        ]),
      ];
      sheets.push(this.createExcelSheet('Model Stats', rows));
    }

    if (data.logs && data.logs.length > 0) {
      const rows = [
        ['Timestamp', 'Model', 'Method', 'Status', 'Input Tokens', 'Output Tokens', 'Duration'],
        ...data.logs.map((l) => [
          l.timestamp,
          l.model,
          l.method,
          l.status,
          l.inputTokens,
          l.outputTokens,
          `${l.duration}ms`,
        ]),
      ];
      sheets.push(this.createExcelSheet('Logs', rows));
    }

    const excelContent = sheets.join('\n\n');
    await writeFile(filePath, excelContent, 'utf-8');
    
    return filePath;
  }

  private createExcelSheet(sheetName: string, rows: any[][]): string {
    return `[${sheetName}]\n${rows.map((row) => row.join('\t')).join('\n')}`;
  }

  async exportToJson(data: ExportData, filename: string): Promise<string> {
    await this.initialize();
    
    const filePath = path.join(this.exportDir, filename);
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    
    return filePath;
  }

  getExportDir(): string {
    return this.exportDir;
  }
}
