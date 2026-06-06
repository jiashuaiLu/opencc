import React, { type ReactNode } from 'react';
import './ui.css';

export interface GlassTableColumn<T = any> {
  key: string;
  title: string;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  render?: (value: any, record: T, index: number) => ReactNode;
  dataIndex?: string;
}

interface GlassTableProps<T = any> {
  columns: GlassTableColumn<T>[];
  data: T[];
  rowKey: string | ((record: T) => string);
  loading?: boolean;
  emptyText?: string;
  className?: string;
  onRowClick?: (record: T) => void;
  expandable?: {
    expandedRowKeys: string[];
    expandedRowRender: (record: T) => ReactNode;
  };
  pagination?: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
  };
}

export function GlassTable<T = any>({
  columns,
  data,
  rowKey,
  loading,
  emptyText = '暂无数据',
  className = '',
  onRowClick,
  expandable,
  pagination,
}: GlassTableProps<T>) {
  const getKey = (record: T) =>
    typeof rowKey === 'function' ? rowKey(record) : String((record as any)[rowKey]);

  const getValue = (record: T, col: GlassTableColumn<T>) => {
    if (col.dataIndex) return (record as any)[col.dataIndex];
    return undefined;
  };

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.pageSize) : 0;

  return (
    <div className={`g-table-wrap ${className}`}>
      {loading && <div className="g-table-loading"><span className="g-btn-spinner" /></div>}
      <table className="g-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={{ width: col.width, textAlign: col.align || 'left' }}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && !loading && (
            <tr><td colSpan={columns.length} className="g-table-empty">{emptyText}</td></tr>
          )}
          {data.map((record, idx) => {
            const key = getKey(record);
            const isExpanded = expandable?.expandedRowKeys.includes(key);
            return (
              <React.Fragment key={key}>
                <tr
                  className={`g-table-row ${onRowClick ? 'g-table-row-clickable' : ''}`}
                  onClick={() => onRowClick?.(record)}
                >
                  {columns.map(col => (
                    <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                      {col.render
                        ? col.render(getValue(record, col), record, idx)
                        : getValue(record, col)}
                    </td>
                  ))}
                </tr>
                {isExpanded && expandable && (
                  <tr className="g-table-expand-row">
                    <td colSpan={columns.length}>
                      {expandable.expandedRowRender(record)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {pagination && totalPages > 1 && (
        <div className="g-table-pagination">
          <button
            className="g-pagination-btn"
            disabled={pagination.current <= 1}
            onClick={() => pagination.onChange(pagination.current - 1)}
          >
            ‹
          </button>
          <span className="g-pagination-info">
            {pagination.current} / {totalPages}
          </span>
          <button
            className="g-pagination-btn"
            disabled={pagination.current >= totalPages}
            onClick={() => pagination.onChange(pagination.current + 1)}
          >
            ›
          </button>
          <span className="g-pagination-total">{pagination.total} 条</span>
        </div>
      )}
    </div>
  );
}
