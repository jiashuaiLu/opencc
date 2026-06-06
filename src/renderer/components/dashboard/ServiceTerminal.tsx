import { useState, useEffect, useRef, memo } from 'react';
import { CodeOutlined, ClearOutlined, DownOutlined, UpOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';

interface LogEntry {
  time: string;
  msg: string;
  level: string;
}

function ServiceTerminal() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (msg: string, level: string) => {
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      setLogs(prev => [...prev, { time, msg, level }]);
    };
    window.electronAPI.onServiceLog(handler);
    return () => window.electronAPI.removeServiceLogListener();
  }, []);

  useEffect(() => {
    if (!collapsed) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, collapsed]);

  return (
    <div className="service-terminal-container">
      <div className="service-terminal-header">
        <span className="service-terminal-title">
          <CodeOutlined /> 服务日志
        </span>
        <span className="service-terminal-actions">
          <Tooltip
            title={
              <div style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 4 }}>如果遇到配置文件权限问题，请在终端执行：</div>
                <code style={{ background: 'rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: 3, display: 'block', marginBottom: 4 }}>
                  sudo chown $(whoami) ~/.claude/settings.json
                </code>
                <code style={{ background: 'rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: 3, display: 'block' }}>
                  chmod 644 ~/.claude/settings.json
                </code>
              </div>
            }
          >
            <button className="service-terminal-btn" title="">
              <QuestionCircleOutlined />
            </button>
          </Tooltip>
          <button
            className="service-terminal-btn"
            onClick={() => setLogs([])}
            title="清空"
          >
            <ClearOutlined />
          </button>
          <button
            className="service-terminal-btn"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? '展开' : '折叠'}
          >
            {collapsed ? <DownOutlined /> : <UpOutlined />}
          </button>
        </span>
      </div>
      {!collapsed && (
        <div className="service-terminal-body">
          {logs.length === 0 ? (
            <div className="service-terminal-empty">启动或停止服务时，日志将在此显示</div>
          ) : (
            logs.map((entry, i) => (
              <div
                key={i}
                className={`service-terminal-line ${entry.level === 'error' ? 'service-terminal-error' : ''}`}
              >
                <span className="service-terminal-time">{entry.time}</span>
                <span className="service-terminal-msg">{entry.msg}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

export default memo(ServiceTerminal);
