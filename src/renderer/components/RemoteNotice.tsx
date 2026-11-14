import { useState, useEffect, useCallback } from 'react';
import { Button } from 'antd';
import { CloseOutlined, CloudDownloadOutlined } from '@ant-design/icons';

interface RemoteNoticeData {
  enabled: boolean;
  latestVersion: string;
  message: string;
  type: 'update' | 'info' | 'warning';
  actionUrl?: string;
  dismissible?: boolean;
}

const typeStyles: Record<string, { background: string; border: string; color: string }> = {
  update: { background: '#e6f7ff', border: '#91d5ff', color: '#1890ff' },
  info: { background: '#f6ffed', border: '#b7eb8f', color: '#52c41a' },
  warning: { background: '#fff7e6', border: '#ffd591', color: '#fa8c16' },
};

export default function RemoteNotice() {
  const [notice, setNotice] = useState<RemoteNoticeData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    window.electronAPI.onRemoteNotice((data) => {
      if (data?.enabled && data?.message) {
        setNotice(data);
      }
    });

    window.electronAPI.getNotice().then((data) => {
      if (data?.enabled && data?.message) {
        setNotice(data);
      }
    }).catch(() => {});

    return () => {
      window.electronAPI.removeRemoteNoticeListener();
    };
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    try {
      await window.electronAPI.checkForUpdates();
    } catch {
      // UpdateNotification 组件会处理后续流程
    }
  }, []);

  const handleAction = useCallback(() => {
    if (notice?.actionUrl) {
      window.electronAPI.openExternal(notice.actionUrl);
    }
  }, [notice]);

  if (!notice || dismissed) return null;

  const style = typeStyles[notice.type] || typeStyles.info;
  const dismissible = notice.dismissible !== false;

  return (
    <div style={{
      background: style.background,
      border: `1px solid ${style.border}`,
      borderRadius: 8,
      padding: '8px 16px',
      marginBottom: 16,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      fontSize: 13,
    }}>
      <span style={{ color: style.color, flex: 1 }}>
        {notice.message}
      </span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        {notice.type === 'update' && (
          <Button size="small" type="primary" icon={<CloudDownloadOutlined />} onClick={handleCheckUpdate}>
            检查更新
          </Button>
        )}
        {notice.actionUrl && notice.type !== 'update' && (
          <Button size="small" type="link" onClick={handleAction}>
            查看详情
          </Button>
        )}
        {dismissible && (
          <CloseOutlined
            style={{ cursor: 'pointer', color: '#8c8c8c', fontSize: 12 }}
            onClick={() => setDismissed(true)}
          />
        )}
      </div>
    </div>
  );
}
