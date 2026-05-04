import { Card, Button, Space, Tag, Modal, Form, Input, message, Empty, Tooltip, Badge, Divider, Typography, Tabs, Select, Spin } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LinkOutlined, StarOutlined, BookOutlined, EyeOutlined, DownOutlined, UpOutlined, ImportOutlined, GithubOutlined, ExclamationCircleOutlined, GlobalOutlined, FolderOutlined, FolderOpenOutlined, SearchOutlined, DownloadOutlined, CheckOutlined, FileZipOutlined, ShopOutlined } from '@ant-design/icons';
import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import '../styles/management.css';

const { Text } = Typography;
const { Search } = Input;

interface SkillApps {
  claude: boolean;
}

interface InstalledSkill {
  id: string;
  name: string;
  description?: string;
  directory: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  readmeUrl?: string;
  apps: SkillApps;
  installedAt: number;
  sourceType: 'global' | 'project';
  sourceProject?: string;
}

interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

interface UnmanagedSkill {
  directory: string;
  name: string;
  description?: string;
  path: string;
  sourceType: 'global' | 'project';
  sourceProject?: string;
  foundIn: string[];
}

interface DiscoverableSkill {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl?: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
}

interface ProjectInfo {
  path: string;
  name: string;
  hasSkills: boolean;
}

const APP_CONFIG = {
  claude: {
    label: 'Claude',
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.1)',
    activeColor: 'rgba(249, 115, 22, 0.2)',
  },
};

type AppId = keyof typeof APP_CONFIG;

function AppCountBar({ totalLabel, counts }: { totalLabel: string; counts: Record<AppId, number> }) {
  return (
    <div className="count-bar">
      <div className="count-bar-left">
        <StarOutlined className="count-bar-icon" />
        <Badge 
          count={totalLabel} 
          className="count-badge"
        />
      </div>
      <div className="count-bar-right">
        {Object.entries(APP_CONFIG).map(([app, config]) => (
          <div
            key={app}
            className="count-item"
            style={{
              background: config.bgColor,
              border: `1px solid ${config.activeColor}`,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>{config.label}</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: config.color }}>{counts[app as AppId]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AppToggleGroup({
  apps,
  onToggle,
}: {
  apps: Record<AppId, boolean>;
  onToggle: (app: AppId, enabled: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {Object.entries(APP_CONFIG).map(([app, config]) => {
        const enabled = apps[app as AppId];
        return (
          <Tooltip key={app} title={`${config.label}${enabled ? ' ✓' : ''}`}>
            <button
              type="button"
              onClick={() => onToggle(app as AppId, !enabled)}
              className="app-toggle-btn"
              style={{
                border: enabled ? `2px solid ${config.color}` : '2px solid var(--border-color)',
                background: enabled ? config.activeColor : 'transparent',
                boxShadow: enabled ? `0 2px 8px ${config.activeColor}` : 'none',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: enabled ? config.color : 'var(--text-disabled-color)' }}>C</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ... ListItemRow is not needed here as we use it from management.css classes directly or we can reuse the one from McpManagement if we export it. 
// For now, let's just inline the div with the class.

function SkillManagement() {
  const [activeTab, setActiveTab] = useState<'installed' | 'discover'>('installed');
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [repos, setRepos] = useState<SkillRepo[]>([]);
  const [discoverableSkills, setDiscoverableSkills] = useState<DiscoverableSkill[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [unmanaged, setUnmanaged] = useState<UnmanagedSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [installingKeys, setInstallingKeys] = useState<Set<string>>(new Set());
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [repoModalVisible, setRepoModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<InstalledSkill | null>(null);
  const [selectedImport, setSelectedImport] = useState<Set<string>>(new Set());
  const [customProjectPath, setCustomProjectPath] = useState('');
  const [scanningCustom, setScanningCustom] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRepo, setFilterRepo] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'installed' | 'uninstalled'>('all');
  const [repoForm] = Form.useForm();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [skillData, repoData, projectData] = await Promise.all([
        window.electronAPI.getSkills(),
        window.electronAPI.getSkillRepos(),
        window.electronAPI.listProjectsWithSkills()
      ]);
      setSkills(skillData || []);
      setRepos(repoData || []);
      setProjects(projectData || []);
    } catch (error) {
      console.error('Failed to load skills:', error);
      message.error('加载 Skills 失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDiscoverableSkills = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const skills = await window.electronAPI.discoverSkills();
      setDiscoverableSkills(skills || []);
    } catch (error) {
      console.error('Failed to discover skills:', error);
      message.error('发现技能失败');
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  const loadUnmanaged = useCallback(async () => {
    try {
      const data = await window.electronAPI.scanUnmanagedSkills();
      setUnmanaged(data || []);
      setSelectedImport(new Set((data || []).map((s: UnmanagedSkill) => s.path)));
    } catch (error) {
      console.error('Failed to scan unmanaged skills:', error);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'discover' && discoverableSkills.length === 0) {
      loadDiscoverableSkills();
    }
  }, [activeTab, discoverableSkills.length, loadDiscoverableSkills]);

  const handleScanCustomProject = useCallback(async () => {
    if (!customProjectPath.trim()) {
      message.warning('请输入项目路径');
      return;
    }

    setScanningCustom(true);
    try {
      const customSkills = await window.electronAPI.scanCustomProject(customProjectPath.trim());
      if (customSkills.length === 0) {
        message.info('该项目中没有发现 Skills');
        return;
      }

      const existingPaths = new Set(unmanaged.map(s => s.path));
      const newSkills = customSkills.filter(s => !existingPaths.has(s.path));

      if (newSkills.length === 0) {
        message.info('该项目中的 Skills 已在列表中');
        return;
      }

      setUnmanaged(prev => [...prev, ...newSkills]);
      setSelectedImport(prev => {
        const newSet = new Set(prev);
        newSkills.forEach(s => newSet.add(s.path));
        return newSet;
      });

      message.success(`发现 ${newSkills.length} 个新 Skills`);
      setCustomProjectPath('');
    } catch (error) {
      message.error('扫描项目失败');
    } finally {
      setScanningCustom(false);
    }
  }, [customProjectPath, unmanaged]);

  const handleDelete = useCallback((skill: InstalledSkill) => {
    Modal.confirm({
      title: '卸载确认',
      icon: <ExclamationCircleOutlined />,
      content: `确定要卸载 Skill "${skill.name}" 吗？这将删除本地文件。`,
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await window.electronAPI.deleteSkill(skill.id);
          message.success('卸载成功');
          loadData();
        } catch (error) {
          message.error('卸载失败');
        }
      },
    });
  }, [loadData]);

  const handleToggleApp = useCallback(async (id: string, app: 'claude', enabled: boolean) => {
    try {
      await window.electronAPI.toggleSkillApp(id, app, enabled);
      loadData();
    } catch (error) {
      message.error('操作失败');
    }
  }, [loadData]);

  const handleViewDetail = useCallback((skill: InstalledSkill) => {
    setSelectedSkill(skill);
    setDetailModalVisible(true);
  }, []);

  const handleOpenInFinder = useCallback(async (skill: InstalledSkill) => {
    try {
      const result = await window.electronAPI.getSkillDirectory(skill.id);

      if (!result.exists) {
        message.warning(`Skill 目录不存在，可能需要重新导入。路径: ${result.dir}`);
        return;
      }

      await window.electronAPI.openInFinder(result.dir);
    } catch (error) {
      console.error('handleOpenInFinder error:', error);
      message.error(`打开目录失败: ${error}`);
    }
  }, []);

  const handleOpenReadme = useCallback(async (url: string) => {
    try {
      await window.electronAPI.openExternal(url);
    } catch (error) {
      console.error('Failed to open URL:', error);
    }
  }, []);

  const handleOpenImport = useCallback(async () => {
    setImportModalVisible(true);
    setScanningCustom(true);
    try {
      const data = await window.electronAPI.scanUnmanagedSkills();
      setUnmanaged(data || []);
      setSelectedImport(new Set((data || []).map((s: UnmanagedSkill) => s.path)));
    } catch (error) {
      console.error('Failed to scan unmanaged skills:', error);
    } finally {
      setScanningCustom(false);
    }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const paths = Array.from(selectedImport);
      if (paths.length === 0) {
        message.warning('请选择要导入的 Skills');
        return;
      }

      let importedCount = 0;
      for (const path of paths) {
        const skill = unmanaged.find(s => s.path === path);
        if (skill) {
          await window.electronAPI.importSkillFromPath(path, skill.sourceType, skill.sourceProject);
          importedCount++;
        }
      }

      message.success(`成功导入 ${importedCount} 个 Skills`);
      setImportModalVisible(false);
      loadData();
    } catch (error) {
      message.error('导入失败');
    }
  }, [selectedImport, unmanaged, loadData]);

  const handleInstallFromZip = useCallback(async () => {
    try {
      const filePath = await window.electronAPI.openZipFileDialog();
      if (!filePath) return;

      message.loading({ content: '正在从 ZIP 文件安装...', key: 'installZip' });
      const installed = await window.electronAPI.installSkillsFromZip(filePath, 'claude');

      if (installed.length === 0) {
        message.warning({ content: 'ZIP 文件中未发现有效的 Skills', key: 'installZip' });
      } else if (installed.length === 1) {
        message.success({ content: `成功安装 Skill: ${installed[0].name}`, key: 'installZip' });
      } else {
        message.success({ content: `成功安装 ${installed.length} 个 Skills`, key: 'installZip' });
      }

      loadData();
    } catch (error) {
      message.error({ content: `安装失败: ${error}`, key: 'installZip' });
    }
  }, [loadData]);

  const handleInstallFromRepo = useCallback(async (skill: DiscoverableSkill) => {
    const key = skill.key;
    setInstallingKeys(prev => new Set(prev).add(key));

    try {
      await window.electronAPI.installSkillFromRepo(skill, 'claude');
      message.success(`成功安装 ${skill.name}`);
      loadData();
      // Refresh discoverable skills to update installed status
      await loadDiscoverableSkills();
    } catch (error) {
      message.error(`安装失败: ${error}`);
    } finally {
      setInstallingKeys(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    }
  }, [loadData, loadDiscoverableSkills]);

  const handleAddRepo = useCallback(async () => {
    try {
      const values = await repoForm.validateFields();
      const repo: SkillRepo = {
        owner: values.owner.trim(),
        name: values.name.trim(),
        branch: values.branch?.trim() || 'main',
        enabled: true,
      };
      await window.electronAPI.saveSkillRepo(repo);
      message.success('仓库添加成功');
      repoForm.resetFields();
      loadData();
      // Refresh discoverable skills
      await loadDiscoverableSkills();
    } catch (error) {
      message.error('添加失败');
    }
  }, [repoForm, loadData, loadDiscoverableSkills]);

  const handleDeleteRepo = useCallback((owner: string, name: string) => {
    Modal.confirm({
      title: '删除确认',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除仓库 "${owner}/${name}" 吗？`,
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await window.electronAPI.deleteSkillRepo(owner, name);
          message.success('仓库删除成功');
          loadData();
          // Refresh discoverable skills
          await loadDiscoverableSkills();
        } catch (error) {
          message.error('删除失败');
        }
      },
    });
  }, [loadData, loadDiscoverableSkills]);

  const handleOpenRepo = useCallback(async (owner: string, name: string) => {
    try {
      await window.electronAPI.openExternal(`https://github.com/${owner}/${name}`);
    } catch (error) {
      console.error('Failed to open URL:', error);
    }
  }, []);

  const enabledCounts = useMemo(() => {
    const counts = { claude: 0 };
    skills.forEach((skill) => {
      if (skill.apps.claude) counts.claude++;
    });
    return counts;
  }, [skills]);

  const globalSkills = useMemo(() => skills.filter(s => s.sourceType === 'global'), [skills]);
  const projectSkills = useMemo(() => skills.filter(s => s.sourceType === 'project'), [skills]);

  const installedSkillKeys = useMemo(() => {
    return new Set(
      skills.map(s => {
        const owner = s.repoOwner?.toLowerCase() || '';
        const name = s.repoName?.toLowerCase() || '';
        return `${s.directory.toLowerCase()}:${owner}:${name}`;
      })
    );
  }, [skills]);

  const repoOptions = useMemo(() => {
    const repoSet = new Set<string>();
    discoverableSkills.forEach((s) => {
      if (s.repoOwner && s.repoName) {
        repoSet.add(`${s.repoOwner}/${s.repoName}`);
      }
    });
    return Array.from(repoSet).sort();
  }, [discoverableSkills]);

  const filteredDiscoverableSkills = useMemo(() => {
    let filtered = discoverableSkills.map(skill => ({
      ...skill,
      installed: installedSkillKeys.has(
        `${skill.directory.toLowerCase()}:${skill.repoOwner.toLowerCase()}:${skill.repoName.toLowerCase()}`
      ),
    }));

    // Filter by repo
    if (filterRepo !== 'all') {
      filtered = filtered.filter(skill => `${skill.repoOwner}/${skill.repoName}` === filterRepo);
    }

    // Filter by status
    if (filterStatus === 'installed') {
      filtered = filtered.filter(skill => skill.installed);
    } else if (filterStatus === 'uninstalled') {
      filtered = filtered.filter(skill => !skill.installed);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(skill =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        `${skill.repoOwner}/${skill.repoName}`.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [discoverableSkills, installedSkillKeys, filterRepo, filterStatus, searchQuery]);

  const getSkillCount = (repo: SkillRepo) =>
    skills.filter(
      (skill) =>
        skill.repoOwner === repo.owner &&
        skill.repoName === repo.name &&
        (skill.repoBranch || 'main') === (repo.branch || 'main')
    ).length;

  const path = window.require ? window.require('path') : { basename: (p: string) => p.split('/').pop() || p };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Skills 管理</h1>
          <p>管理和发现 Claude Code 技能插件</p>
        </div>
      </div>

      <div className="page-content">
        <AppCountBar
          totalLabel={`已安装 ${skills.length} 个 (全局 ${globalSkills.length}, 项目 ${projectSkills.length})`}
          counts={enabledCounts}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20, gap: 12 }}>
          {activeTab === 'installed' && (
            <>
              <Button 
                icon={<FileZipOutlined />} 
                onClick={handleInstallFromZip}
                style={{ borderRadius: 8, height: 36 }}
              >
                从 ZIP 安装
              </Button>
              <Button 
                icon={<ImportOutlined />} 
                onClick={handleOpenImport}
                style={{ borderRadius: 8, height: 36 }}
              >
                扫描并导入
              </Button>
            </>
          )}
          <Button 
            icon={<GithubOutlined />} 
            onClick={() => setRepoModalVisible(true)}
            style={{ borderRadius: 8, height: 36 }}
          >
            管理仓库
          </Button>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as 'installed' | 'discover')}
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'installed',
              label: (
                <span>
                  <FolderOutlined style={{ marginRight: 8 }} />
                  已安装
                </span>
              ),
            },
            {
              key: 'discover',
              label: (
                <span>
                  <ShopOutlined style={{ marginRight: 8 }} />
                  发现
                </span>
              ),
            },
          ]}
        />

        {activeTab === 'installed' ? (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {loading ? (
              <div className="loading-container">
                <Spin size="large" />
              </div>
            ) : skills.length === 0 ? (
              <div className="empty-state-container">
                <div className="empty-placeholder-icon">
                  <StarOutlined style={{ fontSize: 32, color: 'var(--primary-color)' }} />
                </div>
                <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600, color: 'var(--text-color)' }}>
                  暂无 Skills
                </h3>
                <p style={{ margin: '0 0 16px', color: 'var(--text-secondary-color)', fontSize: 14, lineHeight: 1.6 }}>
                  点击"从 ZIP 安装"或"扫描并导入"开始使用
                </p>
                <p style={{ margin: 0, color: 'var(--text-disabled-color)', fontSize: 12 }}>
                  或切换到"发现"标签页从仓库安装
                </p>
              </div>
            ) : (
              <div className="management-list-container">
                {globalSkills.length > 0 && (
                  <>
                    <div style={{ 
                      padding: '12px 20px', 
                      background: 'linear-gradient(90deg, rgba(24, 144, 255, 0.06) 0%, rgba(24, 144, 255, 0.02) 100%)', 
                      borderBottom: '1px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}>
                      <GlobalOutlined style={{ color: '#1890ff', fontSize: 16 }} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-color)' }}>全局 Skills</span>
                      <Tag style={{ marginLeft: 4, borderRadius: 6 }} color="blue">{globalSkills.length}</Tag>
                    </div>
                    {globalSkills.map((skill, index) => (
                      <InstalledSkillItem
                        key={skill.id}
                        skill={skill}
                        onToggleApp={handleToggleApp}
                        onDelete={handleDelete}
                        onOpenInFinder={handleOpenInFinder}
                        onOpenReadme={handleOpenReadme}
                        isLast={index === globalSkills.length - 1 && projectSkills.length === 0}
                      />
                    ))}
                  </>
                )}
                {projectSkills.length > 0 && (
                  <>
                    {globalSkills.length > 0 && (
                      <div style={{ height: 1, background: 'var(--border-color)' }} />
                    )}
                    <div style={{ 
                      padding: '12px 20px', 
                      background: 'linear-gradient(90deg, rgba(82, 196, 26, 0.06) 0%, rgba(82, 196, 26, 0.02) 100%)', 
                      borderBottom: '1px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}>
                      <FolderOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-color)' }}>项目 Skills</span>
                      <Tag style={{ marginLeft: 4, borderRadius: 6 }} color="green">{projectSkills.length}</Tag>
                    </div>
                    {projectSkills.map((skill, index) => (
                      <InstalledSkillItem
                        key={skill.id}
                        skill={skill}
                        onToggleApp={handleToggleApp}
                        onDelete={handleDelete}
                        onOpenInFinder={handleOpenInFinder}
                        onOpenReadme={handleOpenReadme}
                        isLast={index === projectSkills.length - 1}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ marginBottom: 16 }}>
              <Space style={{ width: '100%' }} direction="vertical">
                <Search
                  placeholder="搜索技能..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ width: '100%' }}
                />
                <Space>
                  <Select
                    value={filterRepo}
                    onChange={setFilterRepo}
                    style={{ width: 200 }}
                    options={[
                      { label: '所有仓库', value: 'all' },
                      ...repoOptions.map(repo => ({ label: repo, value: repo })),
                    ]}
                  />
                  <Select
                    value={filterStatus}
                    onChange={setFilterStatus}
                    style={{ width: 120 }}
                    options={[
                      { label: '全部', value: 'all' },
                      { label: '已安装', value: 'installed' },
                      { label: '未安装', value: 'uninstalled' },
                    ]}
                  />
                </Space>
              </Space>
            </div>

            {discoverLoading ? (
              <div className="loading-container">
                <Spin size="large" />
              </div>
            ) : filteredDiscoverableSkills.length === 0 ? (
              <Empty description="没有发现可安装的技能" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                {filteredDiscoverableSkills.map(skill => (
                  <DiscoverableSkillCard
                    key={skill.key}
                    skill={skill}
                    installing={installingKeys.has(skill.key)}
                    onInstall={() => handleInstallFromRepo(skill)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Modals - Detail, Repo, Import - Keeping content structure but ensuring consistent styles */}
        {/* Detail Modal */}
        <Modal
          title={
            <Space>
              <StarOutlined style={{ color: '#722ed1' }} />
              <span>{selectedSkill?.name}</span>
            </Space>
          }
          open={detailModalVisible}
          onCancel={() => setDetailModalVisible(false)}
          width={600}
          footer={[
            <Button key="finder" icon={<FolderOpenOutlined />} onClick={() => {
              handleOpenInFinder(selectedSkill!);
            }}>
              打开目录
            </Button>,
            selectedSkill?.readmeUrl && (
              <Button key="readme" icon={<BookOutlined />} onClick={() => handleOpenReadme(selectedSkill.readmeUrl!)}>
                查看 README
              </Button>
            ),
            <Button key="close" onClick={() => setDetailModalVisible(false)}>
              关闭
            </Button>,
          ]}
        >
          {/* ... Modal content ... */}
          {selectedSkill && (
            <div>
              <Space style={{ marginBottom: 16 }}>
                <Tag color={selectedSkill.sourceType === 'global' ? 'blue' : 'green'}>
                  {selectedSkill.sourceType === 'global' ? '全局' : '项目'}
                </Tag>
                <Tag color="purple">{selectedSkill.directory}</Tag>
                {selectedSkill.repoOwner && selectedSkill.repoName && (
                  <Tag icon={<GithubOutlined />} color="blue">
                    {selectedSkill.repoOwner}/{selectedSkill.repoName}
                  </Tag>
                )}
              </Space>

              {selectedSkill.description && (
                <>
                  <Divider style={{ margin: '12px 0' }} />
                  <div style={{ marginBottom: 16 }}>
                    <Text strong>描述</Text>
                    <p style={{ margin: '8px 0', color: 'var(--text-secondary-color)' }}>{selectedSkill.description}</p>
                  </div>
                </>
              )}

              {selectedSkill.sourceType === 'project' && selectedSkill.sourceProject && (
                <>
                  <Divider style={{ margin: '12px 0' }} />
                  <div style={{ marginBottom: 16 }}>
                    <Text strong>来源项目</Text>
                    <p style={{ margin: '8px 0', color: 'var(--text-secondary-color)' }}>{selectedSkill.sourceProject}</p>
                  </div>
                </>
              )}

              <Divider style={{ margin: '12px 0' }} />

              <div>
                <Text strong>安装信息</Text>
                <div style={{ marginTop: 8 }}>
                  <p style={{ margin: '4px 0', color: 'var(--text-secondary-color)' }}>
                    安装时间: {new Date(selectedSkill.installedAt * 1000).toLocaleString()}
                  </p>
                  <p style={{ margin: '4px 0', color: 'var(--text-secondary-color)' }}>
                    Claude Code: {selectedSkill.apps.claude ? '已启用' : '未启用'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </Modal>

        {/* Repo Modal */}
        <Modal
          title={
            <Space>
              <GithubOutlined style={{ color: '#1890ff' }} />
              <span>管理 Skills 仓库</span>
            </Space>
          }
          open={repoModalVisible}
          onCancel={() => setRepoModalVisible(false)}
          footer={null}
          width={600}
        >
          {/* ... Repo Modal content ... */}
          <div style={{ marginTop: 16 }}>
            <div style={{ padding: 12, background: '#e6f7ff', borderRadius: 6, marginBottom: 16 }}>
              <Text style={{ fontSize: 12 }}>
                💡 添加 GitHub 仓库后，可以从仓库中安装 Skills。例如：anthropics/skills
              </Text>
            </div>
            <Form form={repoForm} layout="vertical">
              <Form.Item label="仓库地址">
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="owner" noStyle rules={[{ required: true, message: '请输入所有者' }]}>
                    <Input placeholder="所有者，例如：anthropics" style={{ width: '40%' }} />
                  </Form.Item>
                  <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', background: 'var(--background-color)', border: '1px solid var(--border-color)' }}>/</span>
                  <Form.Item name="name" noStyle rules={[{ required: true, message: '请输入仓库名' }]}>
                    <Input placeholder="仓库名，例如：skills" style={{ width: '40%' }} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
              <Form.Item name="branch" label="分支">
                <Input placeholder="默认：main" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" onClick={handleAddRepo}>
                  添加仓库
                </Button>
              </Form.Item>
            </Form>

            <Divider style={{ margin: '16px 0' }} />

            <h4 style={{ marginBottom: 12 }}>已添加的仓库</h4>
            {repos.length === 0 ? (
              <p style={{ color: 'var(--text-disabled-color)', fontSize: 14 }}>暂无仓库</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {repos.map((repo) => (
                  <div
                    key={`${repo.owner}/${repo.name}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: 12,
                      border: '1px solid var(--border-color)',
                      background: 'var(--background-color)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>
                        {repo.owner}/{repo.name}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary-color)' }}>
                        分支: {repo.branch || 'main'}
                        <Tag style={{ marginLeft: 8, fontSize: 11 }} color="blue">
                          {getSkillCount(repo)} 个 Skills
                        </Tag>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        type="text"
                        size="small"
                        icon={<LinkOutlined />}
                        onClick={() => handleOpenRepo(repo.owner, repo.name)}
                        title="查看仓库"
                      />
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteRepo(repo.owner, repo.name)}
                        title="删除"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>

        {/* Import Modal */}
        <Modal
          title="导入本地 Skills"
          open={importModalVisible}
          onCancel={() => setImportModalVisible(false)}
          onOk={handleImport}
          okText="导入选中"
          cancelText="取消"
          width={700}
        >
          {/* ... Import Modal content ... */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Input
                placeholder="输入项目路径扫描 Skills，例如：/Users/xxx/projects/my-project"
                value={customProjectPath}
                onChange={(e) => setCustomProjectPath(e.target.value)}
                onPressEnter={handleScanCustomProject}
                prefix={<FolderOpenOutlined style={{ color: '#999' }} />}
              />
              <Button
                type="primary"
                icon={<SearchOutlined />}
                onClick={handleScanCustomProject}
                loading={scanningCustom}
              >
                扫描
              </Button>
            </div>
            <div style={{ padding: 12, background: 'var(--background-color)', borderRadius: 6, marginTop: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                自动扫描目录：
              </Text>
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-secondary-color)', fontSize: 12, lineHeight: '20px' }}>
                <li>全局: ~/.claude/commands/</li>
                <li>项目极简模式: 项目根目录/skills/</li>
                <li>项目插件模式: 项目根目录/.claude-plugin/skills/</li>
                <li>项目配置: 项目根目录/.claude/skills/</li>
              </ul>
            </div>
          </div>

          <Divider style={{ margin: '12px 0' }} />

          {scanningCustom ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
              <Spin />
            </div>
          ) : unmanaged.length === 0 ? (
            <Empty description="没有发现未管理的 Skills" />
          ) : (
            <>
              <p style={{ marginBottom: 12, color: 'var(--text-secondary-color)' }}>
                发现 {unmanaged.length} 个未管理的 Skills，选择后点击导入即可纳入统一管理：
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 350, overflow: 'auto' }}>
              {unmanaged.map((skill) => (
                <label
                  key={skill.path}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    background: selectedImport.has(skill.path) ? 'var(--primary-color-deprecated-bg, rgba(24, 144, 255, 0.1))' : 'var(--surface-color)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedImport.has(skill.path)}
                    onChange={() => {
                      const newSelected = new Set(selectedImport);
                      if (newSelected.has(skill.path)) {
                        newSelected.delete(skill.path);
                      } else {
                        newSelected.add(skill.path);
                      }
                      setSelectedImport(newSelected);
                    }}
                    style={{ marginTop: 4 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 500 }}>{skill.name}</span>
                      <Tag
                        style={{
                          fontSize: 10,
                          padding: '0 6px',
                          lineHeight: '18px',
                          borderRadius: 4,
                          background: skill.sourceType === 'global' ? '#e6f7ff' : '#f6ffed',
                          color: skill.sourceType === 'global' ? '#1890ff' : '#52c41a',
                          border: 'none',
                        }}
                      >
                        {skill.sourceType === 'global' ? '全局' : '项目'}
                      </Tag>
                    </div>
                    {skill.description && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary-color)', marginTop: 4 }}>
                        {skill.description}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-disabled-color)', marginTop: 4 }}>
                      {skill.sourceType === 'project' && skill.sourceProject ? (
                        <span>来源项目: {skill.sourceProject}</span>
                      ) : (
                        <span>{skill.path}</span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
              </div>
            </>
          )}
        </Modal>
      </div>
    </div>
  );
}

// Installed Skill Item Component
function InstalledSkillItem({
  skill,
  onToggleApp,
  onDelete,
  onOpenInFinder,
  onOpenReadme,
  isLast,
}: {
  skill: InstalledSkill;
  onToggleApp: (id: string, app: 'claude', enabled: boolean) => void;
  onDelete: (skill: InstalledSkill) => void;
  onOpenInFinder: (skill: InstalledSkill) => void;
  onOpenReadme: (url: string) => void;
  isLast?: boolean;
}) {
  const path = window.require ? window.require('path') : { basename: (p: string) => p.split('/').pop() || p };
  
  const sourceLabel = skill.repoOwner && skill.repoName
    ? `${skill.repoOwner}/${skill.repoName}`
    : skill.sourceType === 'project' && skill.sourceProject
      ? path.basename(skill.sourceProject)
      : '本地';

  return (
    <div className="list-item-row" style={{ borderBottom: isLast ? 'none' : undefined }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-color)' }}>
            {skill.name}
          </span>
          {skill.readmeUrl && (
            <Tooltip title="查看文档">
              <button
                type="button"
                onClick={() => onOpenReadme(skill.readmeUrl!)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                  color: 'var(--primary-color)',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'all 0.2s',
                }}
              >
                <LinkOutlined style={{ fontSize: 14 }} />
              </button>
            </Tooltip>
          )}
          <Tag
            style={{
              fontSize: 11,
              padding: '2px 10px',
              lineHeight: '20px',
              borderRadius: 6,
              background: skill.sourceType === 'global' ? '#e6f7ff' : '#f6ffed',
              color: skill.sourceType === 'global' ? '#1890ff' : '#52c41a',
              border: 'none',
              fontWeight: 600,
            }}
          >
            {skill.sourceType === 'global' ? '全局' : '项目'}
          </Tag>
          {skill.repoOwner && skill.repoName && (
            <Tag
              icon={<GithubOutlined />}
              style={{
                fontSize: 11,
                padding: '2px 10px',
                lineHeight: '20px',
                borderRadius: 6,
                background: '#f0f5ff',
                color: '#1890ff',
                border: '1px solid #d6e4ff',
              }}
            >
              {skill.repoOwner}/{skill.repoName}
            </Tag>
          )}
          {!skill.repoOwner && !skill.repoName && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>
              {sourceLabel}
            </span>
          )}
        </div>
        {skill.description && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {skill.description}
          </p>
        )}
        {skill.sourceType === 'project' && skill.sourceProject && (
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-disabled-color)' }}>
            来源: {skill.sourceProject}
          </p>
        )}
      </div>

      <AppToggleGroup
        apps={skill.apps}
        onToggle={(app, enabled) => onToggleApp(skill.id, app, enabled)}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Tooltip title="打开目录">
          <Button
            type="text"
            size="small"
            icon={<FolderOpenOutlined style={{ fontSize: 15 }} />}
            onClick={() => onOpenInFinder(skill)}
            style={{ 
              width: 32, 
              height: 32, 
              padding: 0,
              borderRadius: 8,
              color: 'var(--primary-color)',
            }}
          />
        </Tooltip>
        <Tooltip title="卸载">
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined style={{ fontSize: 15 }} />}
            onClick={() => onDelete(skill)}
            style={{ width: 32, height: 32, padding: 0, borderRadius: 8 }}
          />
        </Tooltip>
      </div>
    </div>
  );
}

// Discoverable Skill Card Component
function DiscoverableSkillCard({
  skill,
  installing,
  onInstall,
}: {
  skill: DiscoverableSkill & { installed: boolean };
  installing: boolean;
  onInstall: () => void;
}) {
  const handleOpenReadme = async () => {
    if (!skill.readmeUrl) return;
    try {
      await window.electronAPI.openExternal(skill.readmeUrl);
    } catch (error) {
      console.error('Failed to open URL:', error);
    }
  };

  // Determine if directory should be shown (when it differs from name)
  const showDirectory = Boolean(skill.directory) &&
    skill.directory.trim().toLowerCase() !== skill.name.trim().toLowerCase();

  return (
    <Card
      hoverable
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.3s',
      }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', padding: '16px' } }}
    >
      {/* Gradient overlay on hover */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, rgba(24,144,255,0.05) 0%, transparent 100%)',
        opacity: 0,
        transition: 'opacity 0.5s',
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-color)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {skill.name}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              {showDirectory && (
                <span style={{
                  fontSize: 11,
                  color: 'var(--text-secondary-color)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {skill.directory}
                </span>
              )}
              {skill.repoOwner && skill.repoName && (
                <Tag
                  style={{
                    fontSize: 10,
                    padding: '0 6px',
                    lineHeight: '16px',
                    borderRadius: 4,
                    background: '#f0f5ff',
                    color: '#1890ff',
                    border: '1px solid #d6e4ff',
                  }}
                >
                  {skill.repoOwner}/{skill.repoName}
                </Tag>
              )}
            </div>
          </div>
          {skill.installed && (
            <Tag
              style={{
                background: '#52c41a',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              已安装
            </Tag>
          )}
        </div>
      </div>

      {/* Description */}
      <div style={{ flex: 1, marginBottom: 12 }}>
        <p style={{
          margin: 0,
          fontSize: 12,
          color: 'var(--text-secondary-color)',
          lineHeight: 1.6,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical',
        }}>
          {skill.description || '暂无描述'}
        </p>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex',
        gap: 8,
        paddingTop: 12,
        borderTop: '1px solid var(--border-color)',
      }}>
        {skill.readmeUrl && (
          <Button
            size="small"
            icon={<LinkOutlined />}
            onClick={handleOpenReadme}
            disabled={installing}
            style={{ flex: 1 }}
          >
            查看文档
          </Button>
        )}
        {skill.installed ? (
          <Tag
            color="success"
            icon={<CheckOutlined />}
            style={{
              margin: 0,
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 28,
              borderRadius: 6,
            }}
          >
            已安装
          </Tag>
        ) : (
          <Button
            type="primary"
            size="small"
            icon={<DownloadOutlined />}
            onClick={onInstall}
            loading={installing}
            disabled={!skill.repoOwner}
            style={{ flex: 1 }}
          >
            {installing ? '安装中...' : '安装'}
          </Button>
        )}
      </div>
    </Card>
  );
}

export default memo(SkillManagement);
