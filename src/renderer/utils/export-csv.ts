import * as XLSX from 'xlsx';

export interface ExcelColumn<T = any> {
  title: string;
  dataIndex?: keyof T;
  render?: (record: T, index: number) => string | number;
}

export function exportExcel<T>(filename: string, columns: ExcelColumn<T>[], data: T[], sheetName = 'Sheet1') {
  const header = columns.map(c => c.title);
  const rows = data.map((record, idx) =>
    columns.map(col => {
      if (col.render) return col.render(record, idx);
      return (record as any)[col.dataIndex as string] ?? '';
    })
  );

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

  // 列宽自适应
  ws['!cols'] = columns.map((col, i) => {
    const maxLen = Math.max(
      col.title.length * 2,
      ...rows.map(row => String(row[i]).length)
    );
    return { wch: Math.min(Math.max(maxLen, 8), 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
