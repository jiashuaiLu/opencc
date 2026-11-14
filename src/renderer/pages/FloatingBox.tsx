import { useState, useEffect, useCallback } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { fmtTokens, fmtInt } from '../utils/format';
import '../styles/floating.css';

type TimeRange = '1d' | '7d' | '30d';

const RANGE_OPTIONS: { label: string; value: TimeRange; days: number }[] = [
  { label: '今日', value: '1d', days: 1 },
  { label: '7 天', value: '7d', days: 7 },
  { label: '30 天', value: '30d', days: 30 },
];

const REFRESH_INTERVAL_MS = 30000;

interface Summary {
  totalInputTokens: number;
  totalOutputTokens: number;
}

export default function FloatingBox() {
  const [range, setRange] = useState<TimeRange>('1d');
  const [summary, setSummary] = useState<Summary>({
    totalInputTokens: 0,
    totalOutputTokens: 0,
  });

  const days = RANGE_OPTIONS.find((o) => o.value === range)?.days ?? 1;

  // 仅悬浮窗页面：禁用文档滚动，避免透明窗口下的亚像素溢出产生滚动条/裁切
  useEffect(() => {
    document.body.classList.add('floating-mode');
    return () => {
      document.body.classList.remove('floating-mode');
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startOfToday = Math.floor(today.getTime() / 1000);
      const startTime = days === 1 ? startOfToday : startOfToday - (days - 1) * 24 * 60 * 60;
      const data = await window.electronAPI.getUsageSummary(startTime, now);
      if (data) {
        setSummary({
          totalInputTokens: data.totalInputTokens || 0,
          totalOutputTokens: data.totalOutputTokens || 0,
        });
      }
    } catch (error) {
      console.error('Failed to load floating summary:', error);
    }
  }, [days]);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadData]);

  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;

  const handleClose = () => {
    window.electronAPI.closeFloatingWindow();
  };

  return (
    <div className="floating-box">
      <div className="floating-header">
        <div className="floating-range no-drag">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`floating-range-item ${range === opt.value ? 'is-active' : ''}`}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button className="floating-close no-drag" onClick={handleClose} title="关闭">
          <CloseOutlined />
        </button>
      </div>

      <div className="floating-body">
        <div className="floating-total" title={`${fmtInt(totalTokens)} tokens`}>
          {fmtTokens(totalTokens)}
        </div>
        <div className="floating-total-label">总 Token</div>
        <div className="floating-breakdown">
          <span className="floating-metric" title={`输入 ${fmtInt(summary.totalInputTokens)}`}>
            输入 {fmtTokens(summary.totalInputTokens)}
          </span>
          <span className="floating-metric" title={`输出 ${fmtInt(summary.totalOutputTokens)}`}>
            输出 {fmtTokens(summary.totalOutputTokens)}
          </span>
        </div>
      </div>
    </div>
  );
}
