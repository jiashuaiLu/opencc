import { Button, Space, Tag, Modal, Form, Input, message, Empty, Tooltip, Divider, Typography, Tabs, Select, Spin, Pagination, Segmented, AutoComplete, Upload } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, LinkOutlined, StarOutlined, BookOutlined, EyeOutlined, DownOutlined, UpOutlined, ImportOutlined, GithubOutlined, ExclamationCircleOutlined, GlobalOutlined, FolderOutlined, FolderOpenOutlined, SearchOutlined, DownloadOutlined, CheckOutlined, FileZipOutlined, ShopOutlined, SyncOutlined, SettingOutlined, CrownOutlined, UploadOutlined } from '@ant-design/icons';
import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { GlassButton, GlassInput, GlassSegmented, GlassTag, GlassCard } from '../components/ui';
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

interface CommunitySkill {
  id: string;
  name: string;
  description: string;
  author: string;
  domain: string;
  tags: string[];
  npmPackage: string;
  installCommand: string;
  downloadCount: number;
  skillIconUrl?: string;
  authorAvatar?: string;
  docUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface FeaturedSkill {
  key: string;
  emoji: string;
  category: string;
  name: string;
  directory: string;
  purpose: string;
  highlight?: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  readmeUrl: string;
}

function buildAnthropicSkill(
  directory: string,
  emoji: string,
  category: string,
  name: string,
  purpose: string,
  highlight = 'Anthropic 官方',
): FeaturedSkill {
  return {
    key: `${directory}:anthropics/skills`,
    emoji,
    category,
    name,
    directory: `skills/${directory}`,
    purpose,
    highlight,
    repoOwner: 'anthropics',
    repoName: 'skills',
    repoBranch: 'main',
    readmeUrl: `https://github.com/anthropics/skills/blob/main/skills/${directory}/SKILL.md`,
  };
}

function buildSuperpowersSkill(
  directory: string,
  emoji: string,
  category: string,
  name: string,
  purpose: string,
  highlight = 'Superpowers',
): FeaturedSkill {
  return {
    key: `${directory}:obra/superpowers`,
    emoji,
    category,
    name,
    directory: `skills/${directory}`,
    purpose,
    highlight,
    repoOwner: 'obra',
    repoName: 'superpowers',
    repoBranch: 'main',
    readmeUrl: `https://github.com/obra/superpowers/blob/main/skills/${directory}/SKILL.md`,
  };
}

const FEATURED_SKILLS: FeaturedSkill[] = [
  // === Anthropic 官方 skills/anthropics/skills (17 个) ===
  buildAnthropicSkill('frontend-design', '🎨', 'UI 设计', 'Frontend Design', '告别 AI 千篇一律的紫色渐变与圆角，生成有审美、有层次的现代前端界面'),
  buildAnthropicSkill('canvas-design', '🖼️', '平面设计', 'Canvas Design', '生成海报、社交媒体配图、邀请函等高质量平面设计稿，支持自定义品牌风格'),
  buildAnthropicSkill('algorithmic-art', '🎭', '图像绘制', 'Algorithmic Art', '用代码生成几何艺术、分形、参数化图形，让 Claude 化身创意编码艺术家'),
  buildAnthropicSkill('brand-guidelines', '🏷️', '品牌设计', 'Brand Guidelines', '基于品牌指南生成符合 VI 规范的设计稿，颜色/字体/排版一致性自动校验'),
  buildAnthropicSkill('theme-factory', '🎨', '主题工厂', 'Theme Factory', '快速生成统一风格的设计主题与配色方案，跨页面/组件保持视觉一致'),
  buildAnthropicSkill('web-artifacts-builder', '🌐', 'Web 构建', 'Web Artifacts Builder', '在 Claude.ai Artifacts 中构建可交互的网页应用，支持复杂状态与交互'),
  buildAnthropicSkill('webapp-testing', '🧪', '测试', 'Webapp Testing', '对 Web 应用做端到端测试，包含点击/填表/断言/截图等完整用例'),
  buildAnthropicSkill('mcp-builder', '🛠️', 'MCP 构建', 'MCP Builder', '帮你脚手架式生成 MCP server，自动写 schema、handler 与本地调试入口'),
  buildAnthropicSkill('claude-api', '⚡', 'API 集成', 'Claude API', '调用 Anthropic SDK 的最佳实践（缓存、思考、工具、批处理、Files、引用）'),
  buildAnthropicSkill('skill-creator', '✨', 'Skill 元工具', 'Skill Creator', '交互式向导帮你创建新的 Claude Skill，自动生成 SKILL.md 与目录骨架'),
  buildAnthropicSkill('pdf', '📄', '文档', 'PDF Toolkit', '生成、解析、合并、签署 PDF，支持表单填写、OCR、水印、加密等全生命周期'),
  buildAnthropicSkill('docx', '📝', '文档', 'DOCX Toolkit', '创建/编辑 Word 文档，处理段落、样式、表格、目录、修订等结构化内容'),
  buildAnthropicSkill('pptx', '📊', '文档', 'PPTX Toolkit', '生成专业 PowerPoint 演示稿，模板/版式/动画/讲者备注一站式搞定'),
  buildAnthropicSkill('xlsx', '📈', '文档', 'XLSX Toolkit', '操作 Excel 表格、公式、图表与数据透视表，适合做财务/分析报告'),
  buildAnthropicSkill('doc-coauthoring', '✍️', '协同写作', 'Doc Coauthoring', '与 Claude 协同写长文档，结构化拆章节、保持术语与口径一致'),
  buildAnthropicSkill('internal-comms', '💼', '企业沟通', 'Internal Comms', '撰写规范的内部沟通材料：邮件、公告、变更说明、对外口径'),
  buildAnthropicSkill('slack-gif-creator', '🎬', '趣味', 'Slack GIF Creator', '生成 Slack 风格的搞笑/庆祝 GIF，活跃团队氛围'),

  // === Superpowers obra/superpowers (14 个) ===
  buildSuperpowersSkill('brainstorming', '🧠', '需求澄清', 'Brainstorming', '把模糊想法拆成可落地的设计方案，从需求澄清到 spec→plan→TDD 全流程托管'),
  buildSuperpowersSkill('writing-plans', '📋', '计划', 'Writing Plans', '把复杂任务拆成详尽的实施计划，明确步骤、验证方式与回滚策略'),
  buildSuperpowersSkill('executing-plans', '🚀', '执行', 'Executing Plans', '按计划批量执行，关键节点自动 checkpoint，便于回顾与复盘'),
  buildSuperpowersSkill('test-driven-development', '🔬', 'TDD', 'Test-Driven Development', '严格 RED-GREEN-REFACTOR 循环，配套测试反模式手册避坑'),
  buildSuperpowersSkill('systematic-debugging', '🐛', '调试', 'Systematic Debugging', '4 阶段根因排查流程：复现、隔离、假设、修复，告别瞎猜'),
  buildSuperpowersSkill('verification-before-completion', '✅', '验证', 'Verification Before Completion', '在声称"完成"前真实验证修复有效，避免假阳性'),
  buildSuperpowersSkill('requesting-code-review', '👀', 'Code Review', 'Requesting Code Review', '发起 review 前的自检清单：测试、覆盖、关键路径、潜在副作用'),
  buildSuperpowersSkill('receiving-code-review', '🔁', 'Code Review', 'Receiving Code Review', '面对 review 反馈的处理流程：分类、回复、修改、重新申请合入'),
  buildSuperpowersSkill('dispatching-parallel-agents', '🧵', '并行', 'Dispatching Parallel Agents', '把可独立并行的工作分发给多个 subagent，主线程只做汇总'),
  buildSuperpowersSkill('subagent-driven-development', '🤖', '协作流', 'Subagent-Driven Development', '两阶段 review 协作：先 spec 一致性，再代码质量，迭代飞快'),
  buildSuperpowersSkill('using-git-worktrees', '🌳', 'Git', 'Using Git Worktrees', '在多分支并行开发时使用 worktree，避免 stash 来回切分支带来的混乱'),
  buildSuperpowersSkill('finishing-a-development-branch', '🏁', 'Git', 'Finishing a Branch', '收尾分支的工作流：合并/PR、清理 commit、保护主干'),
  buildSuperpowersSkill('writing-skills', '📚', 'Meta', 'Writing Skills', '官方推荐的 skill 创作指南，包含测试方法学与 SKILL.md 编写规范'),
  buildSuperpowersSkill('using-superpowers', '🦸', 'Meta', 'Using Superpowers', 'Superpowers 体系的入门导览，了解整套 skill 如何协作'),
];

interface JdSkill {
  key: string;
  emoji: string;
  name: string;
  pkg: string;
  purpose: string;
  highlight: string;
  steps: { cmd: string; args: string[] }[];
  docUrl?: string;
}

const NPM_REGISTRY = 'https://registry.npmjs.org/';

const JD_SKILLS: JdSkill[] = [
  {
    key: 'jd:skill-anything',
    emoji: '🛠️',
    name: 'Skill Anything',
    pkg: '@jd/skill-anything',
    purpose: '一站式 Skill 构建与发布助手：引导创建 → 校验 → 打包 npm → 发布到京东内部源，一行命令让团队安装',
    highlight: 'JD 内部 · Skill 生态 · 构建发布',
    docUrl: '',
    steps: [
      { cmd: 'npm', args: ['config', 'set', '@jd:registry', NPM_REGISTRY] },
      { cmd: 'npm', args: ['install', '-g', '@jd/skill-anything'] },
      { cmd: 'skill-anything', args: ['init'] },
    ],
  },
  {
    key: 'jd:joyspace-api-kit',
    emoji: '📘',
    name: 'JoySpace API Kit',
    pkg: '@jd/joyspace-api-kit',
    purpose: '京东 JoySpace 接口工具集 Skill，安装后自动复制到 ~/.claude/skills/js-opt/，开箱即用',
    highlight: 'JD 内部 · API · 自动落盘',
    docUrl: '',
    steps: [
      { cmd: 'npm', args: ['config', 'set', '@jd:registry', NPM_REGISTRY] },
      { cmd: 'npm', args: ['install', '-g', '@jd/joyspace-api-kit'] },
    ],
  },
  {
    key: 'jd:donggui-smoke',
    emoji: '🌫️',
    name: 'DongGui 冒烟测试',
    pkg: '@jd/donggui-smoke-test-skill',
    purpose: '京东内部冒烟测试 Skill，一键扫描页面关键链路并生成回归用例',
    highlight: 'JD 内部 · 冒烟 · @jd 作用域源',
    docUrl: '',
    steps: [
      { cmd: 'npm', args: ['config', 'set', '@jd:registry', NPM_REGISTRY] },
      { cmd: 'npm', args: ['install', '-g', '@jd/donggui-smoke-test-skill'] },
      { cmd: 'donggui-smoke', args: ['init', 'claude'] },
    ],
  },
];

const APP_CONFIG = {
  claude: {
    label: 'Claude',
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.1)',
    activeColor: 'rgba(249, 115, 22, 0.2)',
  },
};

const DOMAIN_OPTIONS = [
  { label: '测试领域', value: '测试领域', color: '#52c41a' },
  { label: '研发领域', value: '研发领域', color: '#1890ff' },
  { label: '工具领域', value: '工具领域', color: '#722ed1' },
  { label: '运营领域', value: '运营领域', color: '#fa8c16' },
  { label: '全栈领域', value: '全栈领域', color: '#13c2c2' },
  { label: '设计领域', value: '设计领域', color: '#eb2f96' },
  { label: 'OPC领域', value: 'OPC领域', color: '#f5222d' },
  { label: '其他领域', value: '其他领域', color: '#8c8c8c' },
];

const DOMAIN_COLOR_MAP: Record<string, string> = Object.fromEntries(DOMAIN_OPTIONS.map(d => [d.value, d.color]));

type AppId = keyof typeof APP_CONFIG;

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
  const [activeTab, setActiveTab] = useState<'square' | 'internal' | 'featured' | 'installed'>('square');
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  const [discoverableSkills, setDiscoverableSkills] = useState<DiscoverableSkill[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [unmanaged, setUnmanaged] = useState<UnmanagedSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [installingKeys, setInstallingKeys] = useState<Set<string>>(new Set());
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [jdInstall, setJdInstall] = useState<{ skill: JdSkill | null; taskId: string; logs: { stream: string; line: string }[]; running: boolean; done: boolean; success: boolean }>({
    skill: null, taskId: '', logs: [], running: false, done: false, success: false,
  });
  const [selectedSkill, setSelectedSkill] = useState<InstalledSkill | null>(null);
  const [selectedImport, setSelectedImport] = useState<Set<string>>(new Set());
  const [customProjectPath, setCustomProjectPath] = useState('');
  const [scanningCustom, setScanningCustom] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRepo, setFilterRepo] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'installed' | 'uninstalled'>('all');
  const [customSkillModalVisible, setCustomSkillModalVisible] = useState(false);
  const [customSkillForm] = Form.useForm();
  const [customInstalling, setCustomInstalling] = useState(false);
  const [installDir, setInstallDir] = useState('');
  const [installDirEditing, setInstallDirEditing] = useState(false);
  const [installDirInput, setInstallDirInput] = useState('');
  const [installDirSaving, setInstallDirSaving] = useState(false);
  const [publishModalVisible, setPublishModalVisible] = useState(false);
  const [publishForm] = Form.useForm();
  const [publishing, setPublishing] = useState(false);
  const [publishTab, setPublishTab] = useState<'npm' | 'zip'>('npm');
  const [zipFile, setZipFile] = useState<any>(null);
  const [communitySkills, setCommunitySkills] = useState<CommunitySkill[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityTotal, setCommunityTotal] = useState(0);
  const [communityPage, setCommunityPage] = useState(1);
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityTagFilter, setCommunityTagFilter] = useState('');
  const [communityDomainFilter, setCommunityDomainFilter] = useState('');
  const [communityInstalling, setCommunityInstalling] = useState<string | null>(null);
  const [currentErp, setCurrentErp] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingSkill, setEditingSkill] = useState<CommunitySkill | null>(null);
  const [editForm] = Form.useForm();
  const [editSaving, setEditSaving] = useState(false);
  const [userAvatar, setUserAvatar] = useState('');
  const [iconFile, setIconFile] = useState<any>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [editIconFile, setEditIconFile] = useState<any>(null);
  const [editIconUploading, setEditIconUploading] = useState(false);

  useEffect(() => {
    loadData();
    window.electronAPI.getSkillInstallDir().then(dir => {
      setInstallDir(dir);
      setInstallDirInput(dir);
    }).catch(() => {});
    window.electronAPI.getErp().then(setCurrentErp).catch(() => {});
    window.electronAPI.getUserInfo().then(info => {
      if (info?.avatar) setUserAvatar(info.avatar);
    }).catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [skillData, projectData] = await Promise.all([
        window.electronAPI.getSkills(),
        window.electronAPI.listProjectsWithSkills()
      ]);
      setSkills(skillData || []);
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

  const loadCommunitySkills = useCallback(async (page = 1, keyword = communitySearch, tags = communityTagFilter, domain = communityDomainFilter) => {
    setCommunityLoading(true);
    try {
      const result = await window.electronAPI.getCommunitySkills({ keyword: keyword || undefined, tags: tags || undefined, domain: domain || undefined, page, pageSize: 12 });
      setCommunitySkills(result.list || []);
      setCommunityTotal(result.total || 0);
      setCommunityPage(page);
    } catch (error) {
      console.error('Failed to load community skills:', error);
    } finally {
      setCommunityLoading(false);
    }
  }, [communitySearch, communityTagFilter, communityDomainFilter]);

  const uploadIconFile = useCallback(async (file: any): Promise<string | undefined> => {
    if (!file) return undefined;
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = Array.from(new Uint8Array(arrayBuffer));
    const result = await window.electronAPI.uploadSkillIcon(uint8Array, file.name);
    return result.fileUrl;
  }, []);

  const handlePublish = useCallback(async () => {
    try {
      const values = await publishForm.validateFields();
      setPublishing(true);

      let npmPackage = values.npmPackage || '';
      let installCommand = values.installCommand || '';

      if (publishTab === 'zip') {
        if (!zipFile) {
          message.error('请选择 ZIP 文件');
          setPublishing(false);
          return;
        }
        const fileName = `${values.name.replace(/\s+/g, '-')}-${Date.now()}.zip`;
        const arrayBuffer = await zipFile.arrayBuffer();
        const uint8Array = Array.from(new Uint8Array(arrayBuffer));
        const result = await window.electronAPI.uploadSkillZip(uint8Array, fileName);
        npmPackage = fileName.replace('.zip', '');
        installCommand = result.fileUrl;
      }

      let skillIconUrl: string | undefined;
      if (iconFile) {
        setIconUploading(true);
        try {
          skillIconUrl = await uploadIconFile(iconFile);
        } finally {
          setIconUploading(false);
        }
      }

      await window.electronAPI.publishCommunitySkill({
        name: values.name,
        description: values.description,
        npmPackage,
        installCommand,
        domain: values.domain,
        tags: values.tags || [],
        docUrl: values.docUrl || undefined,
        skillIconUrl,
        authorAvatar: userAvatar || undefined,
      });
      message.success('发布成功！其他用户现在可以看到你的 Skill');
      setPublishModalVisible(false);
      publishForm.resetFields();
      setZipFile(null);
      setIconFile(null);
      loadCommunitySkills();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(`发布失败: ${error?.message || '未知错误'}`);
    } finally {
      setPublishing(false);
    }
  }, [publishForm, publishTab, zipFile, iconFile, userAvatar, uploadIconFile, loadCommunitySkills]);

  const handleEditCommunitySkill = useCallback((skill: CommunitySkill) => {
    setEditingSkill(skill);
    editForm.setFieldsValue({ description: skill.description, domain: skill.domain, tags: skill.tags, docUrl: skill.docUrl });
    setEditIconFile(null);
    setEditModalVisible(true);
  }, [editForm]);

  const handleSaveEditSkill = useCallback(async () => {
    if (!editingSkill) return;
    try {
      const values = await editForm.validateFields();
      setEditSaving(true);

      let skillIconUrl: string | undefined;
      if (editIconFile) {
        setEditIconUploading(true);
        try {
          skillIconUrl = await uploadIconFile(editIconFile);
        } finally {
          setEditIconUploading(false);
        }
      }

      await window.electronAPI.updateCommunitySkill(editingSkill.id, {
        description: values.description,
        domain: values.domain,
        tags: values.tags || [],
        docUrl: values.docUrl || undefined,
        skillIconUrl,
      });
      message.success('更新成功');
      setEditModalVisible(false);
      setEditingSkill(null);
      setEditIconFile(null);
      editForm.resetFields();
      loadCommunitySkills();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(`更新失败: ${error?.message || '未知错误'}`);
    } finally {
      setEditSaving(false);
    }
  }, [editingSkill, editForm, editIconFile, uploadIconFile, loadCommunitySkills]);

  const handleDeleteCommunitySkill = useCallback((skill: CommunitySkill) => {
    Modal.confirm({
      title: '删除确认',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除 Skill "${skill.name}" 吗？此操作不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await window.electronAPI.deleteCommunitySkill(skill.id);
          message.success('删除成功');
          loadCommunitySkills();
        } catch (error: any) {
          message.error(`删除失败: ${error?.message || '未知错误'}`);
        }
      },
    });
  }, [loadCommunitySkills]);

  const handleInstallCommunitySkill = useCallback(async (skill: CommunitySkill) => {
    setCommunityInstalling(skill.id);
    const taskId = `community-${skill.id}-${Date.now()}`;
    setJdInstall({
      skill: { key: taskId, emoji: '🌐', name: skill.name, pkg: skill.npmPackage, purpose: skill.description, highlight: '社区', steps: [] },
      taskId,
      logs: [],
      running: true,
      done: false,
      success: false,
    });

    const off = window.electronAPI.onInstallScriptLog((data: any) => {
      if (data.taskId !== taskId) return;
      setJdInstall(prev => ({ ...prev, logs: [...prev.logs, { stream: data.stream, line: data.line }] }));
    });

    try {
      const isZipUrl = /^https?:\/\/.+\.zip$/i.test(skill.installCommand.trim());

      if (isZipUrl) {
        const installed = await window.electronAPI.installSkillsFromZipUrl(skill.installCommand.trim(), 'claude');
        if (installed && installed.length > 0) {
          setJdInstall(prev => ({ ...prev, running: false, done: true, success: true }));
          message.success(`${skill.name} 安装成功`);
          try {
            await window.electronAPI.incrementCommunityDownload(skill.id);
          } catch (e) {
            console.warn('Failed to increment download count:', e);
          }
          loadData();
          loadCommunitySkills();
        } else {
          setJdInstall(prev => ({ ...prev, running: false, done: true, success: false }));
          message.error(`${skill.name} 安装失败: ZIP 中未找到有效 Skill`);
        }
      } else {
        const steps = skill.installCommand.split('&&').map(cmd => {
          const parts = cmd.trim().split(/\s+/);
          return { cmd: parts[0], args: parts.slice(1) };
        });
        const result = await window.electronAPI.installSkillByScript(taskId, steps);
        if (result.success) {
          setJdInstall(prev => ({ ...prev, running: false, done: true, success: true }));
          message.success(`${skill.name} 安装成功`);
          try {
            await window.electronAPI.incrementCommunityDownload(skill.id);
          } catch (e) {
            console.warn('Failed to increment download count:', e);
          }
          loadData();
          loadCommunitySkills();
        } else {
          setJdInstall(prev => ({ ...prev, running: false, done: true, success: false }));
          message.error(`${skill.name} 安装失败`);
        }
      }
    } catch (error: any) {
      setJdInstall(prev => ({ ...prev, running: false, done: true, success: false }));
      message.error(`安装失败: ${error?.message || '未知错误'}`);
    } finally {
      off?.();
      setCommunityInstalling(null);
    }
  }, [loadData, loadCommunitySkills]);

  useEffect(() => {
    if (activeTab === 'square' && communitySkills.length === 0) {
      loadCommunitySkills();
    }
    if (activeTab === 'featured' && discoverableSkills.length === 0) {
      loadDiscoverableSkills();
    }
  }, [activeTab, discoverableSkills.length, loadDiscoverableSkills, communitySkills.length, loadCommunitySkills]);

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

  const installedSkillKeys = useMemo(() => {
    return new Set(
      skills.map(s => {
        const dir = s.directory.toLowerCase().split('/').pop() || s.directory.toLowerCase();
        const owner = s.repoOwner?.toLowerCase() || '';
        const name = s.repoName?.toLowerCase() || '';
        return `${dir}:${owner}:${name}`;
      })
    );
  }, [skills]);

  const handleInstallFromRepo = useCallback(async (skill: DiscoverableSkill) => {
    const key = skill.key;
    const dir = skill.directory.toLowerCase().split('/').pop() || skill.directory.toLowerCase();
    const installedKey = `${dir}:${skill.repoOwner.toLowerCase()}:${skill.repoName.toLowerCase()}`;
    const isUpdate = installedSkillKeys.has(installedKey);
    setInstallingKeys(prev => new Set(prev).add(key));

    try {
      await window.electronAPI.installSkillFromRepo(skill, 'claude');
      message.success(isUpdate ? `${skill.name} 已更新` : `成功安装 ${skill.name}`);
      loadData();
      await loadDiscoverableSkills();
    } catch (error) {
      message.error(`${isUpdate ? '更新' : '安装'}失败: ${error}`);
    } finally {
      setInstallingKeys(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    }
  }, [loadData, loadDiscoverableSkills, installedSkillKeys]);

  const handleInstallJdSkill = useCallback(async (skill: JdSkill) => {
    const taskId = `jd-${skill.key}-${Date.now()}`;
    setJdInstall({ skill, taskId, logs: [], running: true, done: false, success: false });
    const off = window.electronAPI.onInstallScriptLog((data) => {
      if (data.taskId !== taskId) return;
      setJdInstall((prev) => ({ ...prev, logs: [...prev.logs, { stream: data.stream, line: data.line }] }));
    });
    try {
      await window.electronAPI.installSkillByScript(taskId, skill.steps);
      setJdInstall((prev) => ({ ...prev, running: false, done: true, success: true }));
      message.success(`${skill.name} 安装完成`);
      loadData();
    } catch (err: any) {
      setJdInstall((prev) => ({ ...prev, running: false, done: true, success: false }));
      message.error(`${skill.name} 安装失败：${err?.message || err}`);
    } finally {
      off?.();
    }
  }, [loadData]);

  const handleCustomSkillInstall = useCallback(async () => {
    try {
      const values = await customSkillForm.validateFields();
      const name = values.customName.trim();
      const command = values.customCommand.trim();

      setCustomInstalling(true);
      const taskId = `custom-${Date.now()}`;
      setJdInstall({ skill: { key: taskId, emoji: '🔧', name, pkg: '', purpose: values.customDesc?.trim() || '', highlight: '自定义', steps: [] }, taskId, logs: [], running: true, done: false, success: false });
      setCustomSkillModalVisible(false);

      const off = window.electronAPI.onInstallScriptLog((data: any) => {
        if (data.taskId !== taskId) return;
        setJdInstall((prev) => ({ ...prev, logs: [...prev.logs, { stream: data.stream, line: data.line }] }));
      });

      const steps = [{ cmd: 'sh', args: ['-c', command] }];
      await window.electronAPI.installSkillByScript(taskId, steps);
      setJdInstall((prev) => ({ ...prev, running: false, done: true, success: true }));
      message.success(`${name} 安装完成`);
      customSkillForm.resetFields();
      loadData();
    } catch (err: any) {
      if (err?.errorFields) return;
      setJdInstall((prev) => ({ ...prev, running: false, done: true, success: false }));
      message.error(`安装失败：${err?.message || err}`);
    } finally {
      setCustomInstalling(false);
    }
  }, [customSkillForm, loadData]);

  const handleSaveInstallDir = useCallback(async () => {
    const dir = installDirInput.trim();
    if (!dir) {
      message.error('路径不能为空');
      return;
    }
    setInstallDirSaving(true);
    try {
      const result = await window.electronAPI.setSkillInstallDir(dir);
      if (result.error) {
        message.error(result.message || '路径无效');
        return;
      }
      setInstallDir(dir);
      setInstallDirEditing(false);
      message.success('安装目录已更新');
    } catch (error) {
      message.error('保存失败');
    } finally {
      setInstallDirSaving(false);
    }
  }, [installDirInput]);

  const handleCancelInstallDir = useCallback(() => {
    setInstallDirInput(installDir);
    setInstallDirEditing(false);
  }, [installDir]);

  const globalSkills = useMemo(() => skills.filter(s => s.sourceType === 'global'), [skills]);
  const projectSkills = useMemo(() => skills.filter(s => s.sourceType === 'project'), [skills]);

  const installedSkillNames = useMemo(() => {
    return new Set(skills.map(s => s.name.toLowerCase()));
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
        `${(skill.directory.toLowerCase().split('/').pop() || skill.directory.toLowerCase())}:${skill.repoOwner.toLowerCase()}:${skill.repoName.toLowerCase()}`
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

  const path = window.require ? window.require('path') : { basename: (p: string) => p.split('/').pop() || p };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-title-group">
          <h1>Skill 广场</h1>
          <p>发现、安装与分享 Claude Code 技能插件</p>
        </div>
      </div>

      <div className="page-content">
        {activeTab === 'installed' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20, gap: 8 }}>
              <GlassButton
                icon={<SettingOutlined />}
                onClick={() => { setInstallDirEditing(true); setInstallDirInput(installDir); }}
              >
                安装目录
              </GlassButton>
              <GlassButton
                icon={<PlusOutlined />}
                onClick={() => setCustomSkillModalVisible(true)}
              >
                npm录入
              </GlassButton>
              <GlassButton
                icon={<FileZipOutlined />}
                onClick={handleInstallFromZip}
              >
                从 ZIP 安装
              </GlassButton>
              <GlassButton
                icon={<ImportOutlined />}
                onClick={handleOpenImport}
              >
                扫描并导入
              </GlassButton>
        </div>
        )}

        <GlassSegmented
          value={activeTab}
          onChange={(key) => {
            setActiveTab(key as typeof activeTab);
            if (key === 'square' && communitySkills.length === 0) loadCommunitySkills();
            if (key === 'featured' && discoverableSkills.length === 0) loadDiscoverableSkills();
          }}
          options={[
            { label: '广场', value: 'square' },
            { label: '内部', value: 'internal' },
            { label: '精选', value: 'featured' },
            { label: '已安装', value: 'installed' },
          ]}
          className="skill-tabs"
        />

        {activeTab === 'installed' && (
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
        )}

        {activeTab === 'square' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <GlassInput
                  placeholder="搜索社区 Skill..."
                  value={communitySearch}
                  onChange={(e) => setCommunitySearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadCommunitySkills(1, communitySearch, communityTagFilter, communityDomainFilter); }}
                  style={{ width: 220 }}
                  size="small"
                  prefix={<SearchOutlined />}
                />
                <GlassInput
                  placeholder="领域筛选"
                  value={communityDomainFilter}
                  onChange={(e) => setCommunityDomainFilter(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadCommunitySkills(1, communitySearch, communityTagFilter, communityDomainFilter); }}
                  style={{ width: 130 }}
                  size="small"
                />
                <GlassInput
                  placeholder="标签筛选"
                  value={communityTagFilter}
                  onChange={(e) => setCommunityTagFilter(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadCommunitySkills(1, communitySearch, communityTagFilter, communityDomainFilter); }}
                  style={{ width: 130 }}
                  size="small"
                />
              </div>
              <GlassButton variant="primary" size="small" icon={<PlusOutlined />} onClick={() => setPublishModalVisible(true)}>
                发布 Skill
              </GlassButton>
            </div>

            {communityLoading ? (
              <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>
            ) : communitySkills.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-secondary-color)', fontSize: 13 }}>
                暂无社区 Skill，点击"发布 Skill"成为第一个分享者
              </div>
            ) : (
              <>
                <div className="featured-grid">
                  {communitySkills.map(skill => {
                    const isInstalled = installedSkillNames.has(skill.name.toLowerCase());
                    return (
                      <div key={skill.id} className="featured-card community">
                        <div className="featured-card-top">
                          {skill.skillIconUrl ? (
                            <img src={skill.skillIconUrl} alt="" className="featured-card-icon" />
                          ) : (
                            <span className="featured-card-emoji">📦</span>
                          )}
                          <div className="featured-card-meta">
                            <span className="featured-card-category" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {skill.authorAvatar && (
                                <img src={skill.authorAvatar} alt="" style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover' }} />
                              )}
                              {skill.author}
                            </span>
                            <span className="featured-card-highlight">{skill.npmPackage}</span>
                          </div>
                        </div>
                        <div className="featured-card-name">{skill.name}</div>
                        <p className="featured-card-purpose">{skill.description}</p>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                          {skill.domain && (
                            <Tag color={DOMAIN_COLOR_MAP[skill.domain] || '#8c8c8c'} style={{ borderRadius: 4, fontSize: 11 }}>{skill.domain}</Tag>
                          )}
                          {skill.tags.map(tag => <Tag key={tag} style={{ borderRadius: 4, fontSize: 11 }}>{tag}</Tag>)}
                        </div>
                        <div className="featured-card-footer">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {skill.docUrl && (
                              <button
                                type="button"
                                className="featured-card-readme"
                                onClick={() => handleOpenReadme(skill.docUrl!)}
                              >
                                <LinkOutlined /> 文档
                              </button>
                            )}
                            <span style={{ fontSize: 12, color: 'var(--text-disabled-color)' }}>
                              <DownloadOutlined /> {skill.downloadCount}
                            </span>
                          </div>
                          <Space size={4}>
                            {skill.author === currentErp && (
                              <>
                                <Tooltip title="编辑">
                                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEditCommunitySkill(skill)} />
                                </Tooltip>
                                <Tooltip title="删除">
                                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteCommunitySkill(skill)} />
                                </Tooltip>
                              </>
                            )}
                            {isInstalled ? (
                              <Button
                                size="small"
                                icon={<SyncOutlined />}
                                loading={communityInstalling === skill.id}
                                disabled={communityInstalling !== null && communityInstalling !== skill.id}
                                onClick={() => handleInstallCommunitySkill(skill)}
                                style={{ borderRadius: 6, fontWeight: 500 }}
                              >
                                {communityInstalling === skill.id ? '更新中...' : '更新'}
                              </Button>
                            ) : (
                              <Button
                                type="primary"
                                size="small"
                                icon={<DownloadOutlined />}
                                loading={communityInstalling === skill.id}
                                disabled={communityInstalling !== null && communityInstalling !== skill.id}
                                onClick={() => handleInstallCommunitySkill(skill)}
                                style={{ borderRadius: 6, fontWeight: 500 }}
                              >
                                {communityInstalling === skill.id ? '安装中...' : '安装'}
                              </Button>
                            )}
                          </Space>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {communityTotal > 12 && (
                  <div style={{ textAlign: 'center', padding: '12px 0' }}>
                    <Pagination
                      current={communityPage}
                      total={communityTotal}
                      pageSize={12}
                      size="small"
                      onChange={(p) => loadCommunitySkills(p)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'internal' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <JdSkillsSection
              installingKey={jdInstall.running ? jdInstall.skill?.key ?? '' : ''}
              onInstall={handleInstallJdSkill}
            />
          </div>
        )}

        {activeTab === 'featured' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <FeaturedSkillsSection
              installedSkillKeys={installedSkillKeys}
              installingKeys={installingKeys}
              onInstall={handleInstallFromRepo}
              onOpenReadme={handleOpenReadme}
            />

            <Divider style={{ margin: '8px 0 16px' }}>
              <Space style={{ color: 'var(--text-secondary-color)', fontSize: 13 }}>
                <GithubOutlined />
                从 GitHub 仓库导入
              </Space>
            </Divider>

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
              <div className="featured-grid">
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

        <Modal
          title={
            <Space>
              <DownloadOutlined style={{ color: jdInstall.success ? '#52c41a' : '#e3342f' }} />
              <span>{jdInstall.skill?.name} {jdInstall.running ? '安装中...' : jdInstall.done ? (jdInstall.success ? '✅ 安装完成' : '❌ 安装失败') : ''}</span>
            </Space>
          }
          open={!!jdInstall.skill}
          onCancel={() => !jdInstall.running && setJdInstall({ skill: null, taskId: '', logs: [], running: false, done: false, success: false })}
          closable={!jdInstall.running}
          maskClosable={!jdInstall.running}
          footer={
            jdInstall.running ? null : (
              <Button type="primary" onClick={() => setJdInstall({ skill: null, taskId: '', logs: [], running: false, done: false, success: false })}>
                关闭
              </Button>
            )
          }
          width={760}
        >
          <div
            style={{
              background: '#0f111a',
              color: '#d1d5db',
              fontFamily: 'Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
              lineHeight: 1.65,
              padding: 14,
              borderRadius: 8,
              maxHeight: 420,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {jdInstall.logs.length === 0 && jdInstall.running && (
              <div style={{ color: '#9ca3af' }}>启动中...</div>
            )}
            {jdInstall.logs.map((l, i) => (
              <div
                key={i}
                style={{
                  color: l.stream === 'meta' ? '#60a5fa' : l.stream === 'stderr' ? '#f87171' : '#d1d5db',
                }}
              >
                {l.line}
              </div>
            ))}
          </div>
        </Modal>

        {/* Install Dir Modal */}
        <Modal
          title={
            <Space>
              <SettingOutlined style={{ color: '#1890ff' }} />
              <span>Skill 安装目录</span>
            </Space>
          }
          open={installDirEditing}
          onCancel={handleCancelInstallDir}
          footer={null}
          width={520}
          destroyOnClose
        >
          <div style={{ padding: '8px 0 0' }}>
            <div style={{ padding: '10px 12px', background: '#e6f7ff', borderRadius: 6, marginBottom: 16, border: '1px solid #91d5ff' }}>
              <Text style={{ fontSize: 12, color: '#096dd9' }}>
                💡 安装的 Skill 文件将同步到此目录，供 Claude Code 读取。修改后新安装的 Skill 将写入新目录，已安装的不会自动迁移。
              </Text>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontWeight: 500, marginBottom: 8 }}>安装目录</label>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={installDirInput}
                  onChange={(e) => setInstallDirInput(e.target.value)}
                  placeholder="例如：/Users/xxx/.claude/skills"
                  onPressEnter={handleSaveInstallDir}
                  style={{ flex: 1 }}
                />
                <Button type="primary" loading={installDirSaving} onClick={handleSaveInstallDir}>
                  保存
                </Button>
              </Space.Compact>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-disabled-color)' }}>
                默认目录：~/.claude/skills/
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Button onClick={handleCancelInstallDir}>关闭</Button>
            </div>
          </div>
        </Modal>

        {/* Custom Skill Modal */}
        <Modal
          title={
            <Space>
              <PlusOutlined style={{ color: '#722ed1' }} />
              <span>自定义录入 Skill</span>
            </Space>
          }
          open={customSkillModalVisible}
          onCancel={() => { setCustomSkillModalVisible(false); customSkillForm.resetFields(); }}
          footer={null}
          width={520}
          destroyOnClose
        >
          <div style={{ padding: '8px 0 0' }}>
            <div style={{ padding: '10px 12px', background: '#fffbe6', borderRadius: 6, marginBottom: 20, border: '1px solid #ffe58f' }}>
              <Text style={{ fontSize: 12, color: '#8c6c00' }}>
                💡 请填写一行能完成安装的命令。如果需要多步操作，请用 <code>&amp;&amp;</code> 串联。
                <br />
                例如：<code>npm i -g my-skill &amp;&amp; my-skill init claude</code>
              </Text>
            </div>
            <Form form={customSkillForm} layout="vertical">
              <Form.Item
                name="customName"
                label="Skill 标题"
                rules={[
                  { required: true, message: '请输入标题' },
                  { max: 18, message: '标题最多 18 个字符' },
                ]}
              >
                <Input placeholder="例如：DongTDD" maxLength={18} showCount />
              </Form.Item>
              <Form.Item
                name="customDesc"
                label="简介"
                rules={[{ required: true, message: '请输入简介' }]}
              >
                <Input.TextArea
                  placeholder="简要描述这个 Skill 的用途"
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  maxLength={200}
                  showCount
                />
              </Form.Item>
              <Form.Item
                name="customCommand"
                label="安装命令"
                rules={[
                  { required: true, message: '请输入安装命令' },
                  { validator: (_, value) => {
                    if (value && value.includes('\n')) {
                      return Promise.reject('只能输入一行命令，多步操作请用 && 串联');
                    }
                    return Promise.resolve();
                  }},
                ]}
                extra="必须一行命令搞定，多个步骤用 && 串联"
              >
                <Input.TextArea
                  placeholder="npm i -g my-skill && my-skill init claude"
                  autoSize={{ minRows: 2, maxRows: 3 }}
                />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                <Space>
                  <Button onClick={() => { setCustomSkillModalVisible(false); customSkillForm.resetFields(); }}>
                    取消
                  </Button>
                  <Button type="primary" onClick={handleCustomSkillInstall} loading={customInstalling}>
                    开始安装
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </div>
        </Modal>

        {/* Publish Community Skill Modal */}
        <Modal
          title={<Space><ShopOutlined style={{ color: '#1890ff' }} /><span>发布 Skill 到社区</span></Space>}
          open={publishModalVisible}
          onCancel={() => { setPublishModalVisible(false); publishForm.resetFields(); setZipFile(null); setPublishTab('npm'); }}
          footer={null}
          width={640}
        >
          <div style={{ padding: '8px 0 0' }}>
            <Tabs
              activeKey={publishTab}
              onChange={(key) => { setPublishTab(key as 'npm' | 'zip'); publishForm.resetFields(); setZipFile(null); }}
              items={[
                { key: 'npm', label: <span><DownloadOutlined style={{ marginRight: 4 }} />npm 包</span> },
                { key: 'zip', label: <span><FileZipOutlined style={{ marginRight: 4 }} />ZIP 包</span> },
              ]}
              style={{ marginBottom: 12 }}
            />
            <div style={{ padding: '8px 12px', background: '#e6f7ff', borderRadius: 6, marginBottom: 16, border: '1px solid #91d5ff' }}>
              <Text style={{ fontSize: 12, color: '#0050b3' }}>
                {publishTab === 'npm'
                  ? '📢 发布后，所有 DongCC 用户都能在广场看到并安装你的 Skill。请填写 npm 包名和安装命令。'
                  : '📦 上传 ZIP 包到 OSS，发布后用户可直接从广场下载安装。'}
              </Text>
            </div>
            <Form form={publishForm} layout="vertical" size="middle">
              <Form.Item name="name" label="Skill 名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="例如：前端代码审查助手" />
              </Form.Item>

              <Form.Item label="Skill 图标">
                <Upload
                  accept="image/*"
                  maxCount={1}
                  beforeUpload={(file) => { setIconFile(file); return false; }}
                  onRemove={() => { setIconFile(null); return true; }}
                  fileList={iconFile ? [iconFile] : []}
                  listType="picture"
                >
                  <Button icon={<UploadOutlined />} loading={iconUploading}>选择图标</Button>
                </Upload>
                <div style={{ fontSize: 12, color: 'var(--text-secondary-color)', marginTop: 4 }}>
                  建议尺寸 64x64，支持 PNG/JPG/SVG
                </div>
              </Form.Item>

              {publishTab === 'npm' ? (
                <>
                  <Form.Item name="npmPackage" label="npm 包名" rules={[{ required: true, message: '请输入 npm 包名' }]}>
                    <Input placeholder="例如：@jd/my-skill" />
                  </Form.Item>
                  <Form.Item
                    name="installCommand"
                    label="安装命令"
                    rules={[
                      { required: true, message: '请输入安装命令' },
                      { validator: (_, value) => value && value.includes('\n') ? Promise.reject('多步操作请用 && 串联') : Promise.resolve() },
                    ]}
                    extra="多个步骤用 && 串联"
                    style={{ marginBottom: 12 }}
                  >
                    <Input.TextArea
                      placeholder="npm i -g my-skill && my-skill init claude"
                      autoSize={{ minRows: 1, maxRows: 2 }}
                    />
                  </Form.Item>
                </>
              ) : (
                <Form.Item label="ZIP 文件" required style={{ marginBottom: 12 }}>
                  <Upload.Dragger
                    accept=".zip"
                    maxCount={1}
                    beforeUpload={(file) => { setZipFile(file); return false; }}
                    onRemove={() => { setZipFile(null); return true; }}
                    fileList={zipFile ? [zipFile] : []}
                  >
                    <p style={{ fontSize: 32, color: '#1890ff', marginBottom: 8 }}><UploadOutlined /></p>
                    <p style={{ fontSize: 14, color: 'var(--text-color)' }}>点击或拖拽 ZIP 文件到此处</p>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>仅支持 .zip 格式</p>
                  </Upload.Dragger>
                </Form.Item>
              )}

              <Form.Item name="description" label="功能描述" rules={[{ required: true, message: '请输入描述' }]} style={{ marginBottom: 12 }}>
                <Input.TextArea placeholder="简要说明这个 Skill 的用途和功能" autoSize={{ minRows: 2, maxRows: 3 }} />
              </Form.Item>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Form.Item name="domain" label="适用领域" rules={[{ required: true, message: '请选择或输入领域' }]}>
                  <AutoComplete
                    placeholder="选择或输入自定义领域"
                    options={DOMAIN_OPTIONS.map(d => ({ label: d.label, value: d.value }))}
                    filterOption={(input, option) =>
                      (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </Form.Item>
                <Form.Item name="docUrl" label="文档链接">
                  <Input placeholder="https://..." />
                </Form.Item>
              </div>
              <Form.Item name="tags" label="标签" style={{ marginBottom: 12 }}>
                <Select mode="tags" placeholder="输入后回车添加" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                <Space>
                  <Button onClick={() => { setPublishModalVisible(false); publishForm.resetFields(); setZipFile(null); setPublishTab('npm'); }}>取消</Button>
                  <Button type="primary" onClick={handlePublish} loading={publishing}>
                    {publishTab === 'zip' ? '上传并发布' : '发布'}
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </div>
        </Modal>

        {/* Edit Community Skill Modal */}
        <Modal
          title={<Space><EditOutlined style={{ color: '#1890ff' }} /><span>编辑 Skill</span></Space>}
          open={editModalVisible}
          onCancel={() => { setEditModalVisible(false); setEditingSkill(null); editForm.resetFields(); }}
          footer={null}
          width={520}
        >
          <div style={{ padding: '8px 0 0' }}>
            <Form form={editForm} layout="vertical">
              <Form.Item label="Skill 名称">
                <Input value={editingSkill?.name} disabled />
              </Form.Item>
              <Form.Item label="Skill 图标">
                {editingSkill?.skillIconUrl && !editIconFile && (
                  <div style={{ marginBottom: 8 }}>
                    <img src={editingSkill.skillIconUrl} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border-color)' }} />
                  </div>
                )}
                <Upload
                  accept="image/*"
                  maxCount={1}
                  beforeUpload={(file) => { setEditIconFile(file); return false; }}
                  onRemove={() => { setEditIconFile(null); return true; }}
                  fileList={editIconFile ? [editIconFile] : []}
                  listType="picture"
                >
                  <Button icon={<UploadOutlined />} loading={editIconUploading}>{editingSkill?.skillIconUrl ? '更换图标' : '上传图标'}</Button>
                </Upload>
              </Form.Item>
              <Form.Item name="description" label="功能描述" rules={[{ required: true, message: '请输入描述' }]}>
                <Input.TextArea placeholder="简要说明这个 Skill 的用途和功能" autoSize={{ minRows: 2, maxRows: 4 }} />
              </Form.Item>
              <Form.Item name="domain" label="适用领域" rules={[{ required: true, message: '请选择或输入领域' }]}>
                <AutoComplete
                  placeholder="选择或输入自定义领域"
                  options={DOMAIN_OPTIONS.map(d => ({ label: d.label, value: d.value }))}
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                />
              </Form.Item>
              <Form.Item name="tags" label="标签">
                <Select mode="tags" placeholder="输入标签后回车添加" />
              </Form.Item>
              <Form.Item name="docUrl" label="文档链接">
                <Input placeholder="https://..." />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                <Space>
                  <Button onClick={() => { setEditModalVisible(false); setEditingSkill(null); editForm.resetFields(); }}>取消</Button>
                  <Button type="primary" onClick={handleSaveEditSkill} loading={editSaving}>保存</Button>
                </Space>
              </Form.Item>
            </Form>
          </div>
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

// JD Skills Section - 京东内部 skill 一键安装
function JdSkillsSection({
  installingKey,
  onInstall,
}: {
  installingKey: string;
  onInstall: (skill: JdSkill) => void;
}) {
  const [downloadCounts, setDownloadCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    JD_SKILLS.forEach(async (skill) => {
      try {
        const res = await fetch(`https://api.npmjs.org/downloads/range/${start}:${end}/${skill.pkg}`);
        if (!res.ok) return;
        const data = await res.json();
        const total = (data.downloads || []).reduce((sum: number, d: { downloads: number }) => sum + d.downloads, 0);
        setDownloadCounts(prev => ({ ...prev, [skill.key]: total }));
      } catch { /* ignore */ }
    });
  }, []);

  return (
    <div className="featured-grid">
      {JD_SKILLS.map((skill) => {
        const installing = installingKey === skill.key;
        const anyInstalling = installingKey !== '';
        const count = downloadCounts[skill.key];
        return (
          <div key={skill.key} className="featured-card community">
            <div className="featured-card-top">
              <span className="featured-card-emoji">{skill.emoji}</span>
              <div className="featured-card-meta">
                <span className="featured-card-category">{skill.highlight}</span>
                <span className="featured-card-highlight">{skill.pkg}</span>
              </div>
            </div>
            <div className="featured-card-name">{skill.name}</div>
            <p className="featured-card-purpose">{skill.purpose}</p>
            <div className="featured-card-footer">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {skill.docUrl && (
                  <Button
                    type="link"
                    size="small"
                    icon={<LinkOutlined />}
                    onClick={() => window.electronAPI.openExternal(skill.docUrl!)}
                    style={{ padding: 0, fontSize: 12 }}
                  >
                    文档
                  </Button>
                )}
                {count !== undefined && (
                  <span style={{ fontSize: 12, color: 'var(--text-secondary-color)' }}>
                    <DownloadOutlined style={{ marginRight: 3 }} />{count}
                  </span>
                )}
              </span>
              <Button
                type="primary"
                size="small"
                icon={<DownloadOutlined />}
                loading={installing}
                disabled={anyInstalling && !installing}
                onClick={() => onInstall(skill)}
                style={{ borderRadius: 6, fontWeight: 500 }}
              >
                {installing ? '安装中...' : '一键安装'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Featured Skills Section - 全量推荐 Anthropic + Superpowers，分仓库 Tab + 分页
const FEATURED_PAGE_SIZE = 9;
type FeaturedRepoFilter = 'all' | 'anthropics/skills' | 'obra/superpowers';

function FeaturedSkillsSection({
  installedSkillKeys,
  installingKeys,
  onInstall,
  onOpenReadme,
}: {
  installedSkillKeys: Set<string>;
  installingKeys: Set<string>;
  onInstall: (skill: DiscoverableSkill) => void;
  onOpenReadme: (url: string) => void;
}) {
  const [repoFilter, setRepoFilter] = useState<FeaturedRepoFilter>('all');
  const [page, setPage] = useState(1);

  const counts = useMemo(() => {
    const anthropic = FEATURED_SKILLS.filter(s => s.repoOwner === 'anthropics').length;
    const superpowers = FEATURED_SKILLS.filter(s => s.repoOwner === 'obra').length;
    return { all: FEATURED_SKILLS.length, anthropic, superpowers };
  }, []);

  const filtered = useMemo(() => {
    if (repoFilter === 'all') return FEATURED_SKILLS;
    if (repoFilter === 'anthropics/skills') return FEATURED_SKILLS.filter(s => s.repoOwner === 'anthropics');
    return FEATURED_SKILLS.filter(s => s.repoOwner === 'obra');
  }, [repoFilter]);

  const total = filtered.length;
  const pageStart = (page - 1) * FEATURED_PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + FEATURED_PAGE_SIZE);

  // 切换 Tab 时重置到第一页
  useEffect(() => {
    setPage(1);
  }, [repoFilter]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Segmented
          value={repoFilter}
          onChange={(v) => setRepoFilter(v as FeaturedRepoFilter)}
          options={[
            { label: `全部 (${counts.all})`, value: 'all' },
            { label: `Anthropic 官方 (${counts.anthropic})`, value: 'anthropics/skills' },
            { label: `Superpowers (${counts.superpowers})`, value: 'obra/superpowers' },
          ]}
        />
      </div>

      <div className="featured-grid">
        {pageItems.map((featured) => {
          const installedKey = `${(featured.directory.toLowerCase().split('/').pop() || featured.directory.toLowerCase())}:${featured.repoOwner.toLowerCase()}:${featured.repoName.toLowerCase()}`;
          const installed = installedSkillKeys.has(installedKey);
          const installing = installingKeys.has(featured.key);
          const skillForInstall: DiscoverableSkill = {
            key: featured.key,
            name: featured.name,
            description: featured.purpose,
            directory: featured.directory,
            readmeUrl: featured.readmeUrl,
            repoOwner: featured.repoOwner,
            repoName: featured.repoName,
            repoBranch: featured.repoBranch,
          };
          return (
            <div key={featured.key} className="featured-card">
              <div className="featured-card-top">
                <span className="featured-card-emoji">{featured.emoji}</span>
                <div className="featured-card-meta">
                  <span className="featured-card-category">{featured.category}</span>
                  {featured.highlight && (
                    <span className="featured-card-highlight">{featured.highlight}</span>
                  )}
                </div>
              </div>
              <div className="featured-card-name">{featured.name}</div>
              <p className="featured-card-purpose">{featured.purpose}</p>
              <div className="featured-card-footer">
                <button
                  type="button"
                  className="featured-card-readme"
                  onClick={() => onOpenReadme(featured.readmeUrl)}
                >
                  <LinkOutlined /> 文档
                </button>
                {installed ? (
                  <Button
                    size="small"
                    icon={<SyncOutlined />}
                    loading={installing}
                    onClick={() => onInstall(skillForInstall)}
                    style={{ borderRadius: 6, fontWeight: 500 }}
                  >
                    {installing ? '更新中' : '更新'}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    size="small"
                    icon={<DownloadOutlined />}
                    loading={installing}
                    onClick={() => onInstall(skillForInstall)}
                    style={{ borderRadius: 6, fontWeight: 500 }}
                  >
                    {installing ? '安装中' : '一键安装'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {total > FEATURED_PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Pagination
            current={page}
            pageSize={FEATURED_PAGE_SIZE}
            total={total}
            onChange={setPage}
            showSizeChanger={false}
            size="small"
          />
        </div>
      )}
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

  return (
    <div className="featured-card">
      <div className="featured-card-top">
        <span className="featured-card-emoji">📂</span>
        <div className="featured-card-meta">
          {skill.repoOwner && skill.repoName && (
            <span className="featured-card-category">{skill.repoOwner}/{skill.repoName}</span>
          )}
          <span className="featured-card-highlight">{skill.directory}</span>
        </div>
      </div>
      <div className="featured-card-name">{skill.name}</div>
      <p className="featured-card-purpose">{skill.description || '暂无描述'}</p>
      <div className="featured-card-footer">
        {skill.readmeUrl ? (
          <button type="button" className="featured-card-readme" onClick={handleOpenReadme}>
            <LinkOutlined /> 文档
          </button>
        ) : <span />}
        {skill.installed ? (
          <Button
            size="small"
            icon={<SyncOutlined />}
            onClick={onInstall}
            loading={installing}
            disabled={!skill.repoOwner}
            style={{ borderRadius: 6, fontWeight: 500 }}
          >
            {installing ? '更新中...' : '更新'}
          </Button>
        ) : (
          <Button
            type="primary"
            size="small"
            icon={<DownloadOutlined />}
            onClick={onInstall}
            loading={installing}
            disabled={!skill.repoOwner}
            style={{ borderRadius: 6, fontWeight: 500 }}
          >
            {installing ? '安装中...' : '安装'}
          </Button>
        )}
      </div>
    </div>
  );
}

export default memo(SkillManagement);
