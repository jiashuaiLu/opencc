import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Progress, Button, message, Typography, Space, Tag } from 'antd';
import {
  CloudDownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

declare global {
  interface Window {
    electronAPI: {
      checkForUpdates: () => Promise<{ available: boolean; version: string; currentVersion: string }>;
      downloadUpdate: () => Promise<{ success: boolean }>;
      installUpdate: () => void;
      getCurrentVersion: () => Promise<string>;
      onUpdateChecking: (callback: () => void) => void;
      onUpdateAvailable: (callback: (info: UpdateInfo) => void) => void;
      onUpdateNotAvailable: (callback: (info: { version: string }) => void) => void;
      onUpdateDownloadProgress: (callback: (progress: DownloadProgress) => void) => void;
      onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => void;
      onUpdateError: (callback: (error: { message: string }) => void) => void;
      removeUpdateListeners: () => void;
    };
  }
}

const UpdateNotification: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const initVersion = async () => {
      try {
        const version = await window.electronAPI.getCurrentVersion();
        setCurrentVersion(version);
      } catch (error) {
        console.error('Failed to get current version:', error);
      }
    };

    initVersion();

    window.electronAPI.onUpdateChecking(() => {
      setStatus('checking');
    });

    window.electronAPI.onUpdateAvailable((info) => {
      setStatus('available');
      setUpdateInfo(info);
      setVisible(true);
    });

    window.electronAPI.onUpdateNotAvailable((info) => {
      setStatus('idle');
      message.info(`当前已是最新版本 ${info.version}`);
    });

    window.electronAPI.onUpdateDownloadProgress((progress) => {
      setStatus('downloading');
      setDownloadProgress(progress);
    });

    window.electronAPI.onUpdateDownloaded((info) => {
      setStatus('downloaded');
      setUpdateInfo(info);
      setDownloadProgress(null);
    });

    window.electronAPI.onUpdateError((error) => {
      setStatus('error');
      setErrorMessage(error.message);
    });

    return () => {
      window.electronAPI.removeUpdateListeners();
    };
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    try {
      setStatus('checking');
      await window.electronAPI.checkForUpdates();
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || '检查更新失败');
    }
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      setStatus('downloading');
      await window.electronAPI.downloadUpdate();
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || '下载更新失败');
    }
  }, []);

  const handleInstall = useCallback(() => {
    Modal.confirm({
      title: '安装更新',
      content: '应用将关闭并安装新版本，是否继续？',
      okText: '立即安装',
      cancelText: '稍后安装',
      onOk: () => {
        window.electronAPI.installUpdate();
      },
    });
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    if (status === 'downloaded') {
      Modal.confirm({
        title: '稍后安装',
        content: '更新已下载，将在下次启动时自动安装。',
        okText: '知道了',
        cancelButtonProps: { style: { display: 'none' } },
      });
    }
  }, [status]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    return formatBytes(bytesPerSecond) + '/s';
  };

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CloudDownloadOutlined spin style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
            <Text>正在检查更新...</Text>
          </div>
        );

      case 'available':
        return (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <Text strong>发现新版本 </Text>
              <Tag color="green">{updateInfo?.version}</Tag>
              <Text type="secondary"> (当前版本: {currentVersion})</Text>
            </div>
            {updateInfo?.releaseDate && (
              <Text type="secondary">发布日期: {formatDate(updateInfo.releaseDate)}</Text>
            )}
            {updateInfo?.releaseNotes && (
              <div>
                <Text strong>更新说明:</Text>
                <Paragraph
                  style={{ marginTop: 8, maxHeight: 150, overflow: 'auto' }}
                  ellipsis={{ rows: 4, expandable: true }}
                >
                  {updateInfo.releaseNotes}
                </Paragraph>
              </div>
            )}
            <div style={{ textAlign: 'right' }}>
              <Button onClick={handleClose} style={{ marginRight: 8 }}>
                稍后提醒
              </Button>
              <Button type="primary" icon={<CloudDownloadOutlined />} onClick={handleDownload}>
                立即下载
              </Button>
            </div>
          </Space>
        );

      case 'downloading':
        return (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Text>正在下载更新...</Text>
            <Progress
              percent={downloadProgress?.percent || 0}
              status="active"
              format={(percent) => `${percent?.toFixed(1)}%`}
            />
            {downloadProgress && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">
                  {formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}
                </Text>
                <Text type="secondary">{formatSpeed(downloadProgress.bytesPerSecond)}</Text>
              </div>
            )}
          </Space>
        );

      case 'downloaded':
        return (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div style={{ textAlign: 'center' }}>
              <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
              <Text strong style={{ display: 'block', marginTop: 8 }}>
                更新已下载完成
              </Text>
              <Text type="secondary">版本 {updateInfo?.version}</Text>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Button onClick={handleClose} style={{ marginRight: 8 }}>
                稍后安装
              </Button>
              <Button type="primary" icon={<ReloadOutlined />} onClick={handleInstall}>
                立即安装并重启
              </Button>
            </div>
          </Space>
        );

      case 'error':
        return (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div style={{ textAlign: 'center' }}>
              <ExclamationCircleOutlined style={{ fontSize: 48, color: '#ff4d4f', marginBottom: 16 }} />
              <Text type="danger" style={{ display: 'block', marginTop: 8 }}>
                更新失败
              </Text>
              <Text type="secondary">{errorMessage}</Text>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Button onClick={() => setVisible(false)}>关闭</Button>
              <Button type="primary" style={{ marginLeft: 8 }} onClick={handleCheckUpdate}>
                重试
              </Button>
            </div>
          </Space>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      title="软件更新"
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={480}
      maskClosable={false}
    >
      {renderContent()}
    </Modal>
  );
};

export default UpdateNotification;
