import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getSites, addSite, deleteSite, getTags, addTag, deleteTag, updateTag, getStorageInfo, openDataDir, repairMissingPostersSilent, getPosterRepairStatus, deleteVideosByCategory, getAllCategories, createCategory, updateCategory, deleteCategory, parseCategoryFeatures, scanCategory, getAllActorFields, updateActorField, createActorField, deleteActorField, getPresetTemplates, getExtensionPresetTemplates, enablePresetTemplate, disablePresetTemplate, reorderCategories, checkLatestRelease, setGameOverlayDisabled, getGameOverlayDisabled, getTagColor, downloadUpdate, cancelUpdateDownload, installUpdate, cleanupOldInstallers } from '../utils/api';
import type { Site, Tag, StorageInfo, Category, CategoryFeatures, ActorField, PresetTemplate, PosterRepairStatus } from '../utils/api';
// confirm dialog removed — using custom React modal instead
import { useSecondConfirm } from '../utils/useSecondConfirm';
import { useLibraryStore } from '../store/libraryStore';
import loadingIcon from '../assets/icons/loading.svg';
import Switch from '../components/Switch';
import ConfirmDialog from '../components/ConfirmDialog';
import BubbleSelect from '../components/BubbleSelect';
import { open } from '@tauri-apps/plugin-dialog';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { listen } from '@tauri-apps/api/event';
import { notify } from '../utils/notify';
import { changelogData, currentVersion } from '../generated/versionInfo';

type GitHubRelease = {
  tag_name: string;
  html_url: string;
  body?: string | null;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
};

const normalizeVersion = (version: string) => version.replace(/^v/i, '').trim();

const compareVersions = (a: string, b: string) => {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
};

const findPlatformInstaller = (release: GitHubRelease) => {
  const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');
  if (isMac) {
    return release.assets.find((asset) => /\.dmg$/i.test(asset.name));
  }
  return (
    release.assets.find((asset) => /x64-setup\.exe$/i.test(asset.name)) ||
    release.assets.find((asset) => /\.exe$/i.test(asset.name)) ||
    release.assets.find((asset) => /\.msi$/i.test(asset.name))
  );
};

const Settings: React.FC = () => {
  const [sites, setSites] = useState<Site[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [posterRepairStatus, setPosterRepairStatus] = useState<PosterRepairStatus>({ status: 'idle', scanned_series: 0, updated_series: 0, scanned_videos: 0, updated_videos: 0, skipped: 0, error: null });
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSite, setNewSite] = useState({ name: '', url: '', parser_type: 'auto', config: '{}' });
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<{ id: number; name: string } | null>(null);
  const [editingTagValue, setEditingTagValue] = useState('');
  const { pendingKey, requestSecondConfirm } = useSecondConfirm();

  useEffect(() => {
    window.scrollTo(0, 0);
    loadSettingsData();
    getPosterRepairStatus().then(setPosterRepairStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (posterRepairStatus.status !== 'running') return;
    const timer = window.setInterval(() => {
      getPosterRepairStatus()
        .then((status) => {
          setPosterRepairStatus(status);
          if (status.status === 'success') {
            notify({ message: `海报更新成功，更新了 ${status.updated_series} 个视频集`, type: 'success' });
          } else if (status.status === 'error') {
            notify({ message: '海报更新失败: ' + (status.error || '未知错误'), type: 'error' });
          }
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [posterRepairStatus.status]);

  const loadSettingsData = async () => {
    try {
      const [sitesList, tagsList, storage, catsList, fieldsList, overlayDisabled] = await Promise.all([getSites(), getTags(), getStorageInfo(), getAllCategories(), getAllActorFields(), getGameOverlayDisabled().catch(() => false)]);
      setSites(sitesList);
      setTags(tagsList);
      setStorageInfo(storage);
      setCategories(catsList);
      setActorFields(fieldsList);
      setGameOverlayState(overlayDisabled);
      // 加载扩展预设模板
      try {
        const templates = await getExtensionPresetTemplates();
        setPresetTemplates(templates);
        const allTemplates = await getPresetTemplates();
        setAllPresetTemplates(allTemplates);
        const map: Record<string, boolean> = {};
        for (const t of templates) {
          map[t.key] = fieldsList.some((f: ActorField) => f.field_key === t.key && f.enabled);
        }
        setPresetEnabledMap(map);
      } catch {}
    } catch (error) {
      console.error('加载设置失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSites = async () => {
    const sitesList = await getSites();
    setSites(sitesList);
  };

  const loadTags = async () => {
    const tagsList = await getTags();
    setTags(tagsList);
  };

  const handleRepairMissingPosters = async () => {
    if (posterRepairStatus.status === 'running') return;
    try {
      setPosterRepairStatus({ status: 'running', scanned_series: 0, updated_series: 0, scanned_videos: 0, updated_videos: 0, skipped: 0, error: null });
      await repairMissingPostersSilent();
      notify({ message: '海报更新中，可继续使用', type: 'info' });
    } catch (error) {
      console.error('启动批量修复海报失败:', error);
      setPosterRepairStatus((current) => ({ ...current, status: 'error', error: '更新失败，请稍后重试' }));
      notify({ message: '启动失败，请稍后重试', type: 'error' });
    }
  };

  const handleAddSite = async () => {
    if (!newSite.name.trim() || !newSite.url.trim()) return;
    
    try {
      await addSite({
        name: newSite.name,
        url: newSite.url,
        parser_type: newSite.parser_type,
        config: JSON.parse(newSite.config)
      });
      setShowAddModal(false);
      setNewSite({ name: '', url: '', parser_type: 'auto', config: '{}' });
      loadSites();
    } catch (error) {
      console.error('添加网站失败:', error);
    }
  };

  const handleDeleteSite = async (id: number) => {
    try {
      await deleteSite(id);
      loadSites();
    } catch (error) {
      console.error('删除网站失败:', error);
    }
  };

  const handleAddTag = async () => {
    const name = newTagName.trim();
    if (!name) return;

    try {
      await addTag(name);
      setNewTagName('');
      loadTags();
    } catch (error) {
      console.error('添加标签失败:', error);
    }
  };

  const handleDeleteTag = async (id: number) => {
    try {
      await deleteTag(id);
      loadTags();
    } catch (error) {
      console.error('删除标签失败:', error);
    }
  };

  const handleSaveTagEdit = async () => {
    if (!editingTag) return;
    const newName = editingTagValue.trim();
    if (!newName || newName === editingTag.name) {
      setEditingTag(null);
      return;
    }
    try {
      await updateTag(editingTag.id, newName);
      setEditingTag(null);
      loadTags();
    } catch (error) {
      console.error('更新标签失败:', error);
    }
  };

  const [deleteCatConfirm, setDeleteCatConfirm] = useState<string | null>(null);
  const refreshSeries = useLibraryStore((s) => s.refreshSeries);
  const refreshCategories = useLibraryStore((s) => s.refreshCategories);

  const reloadCategoriesEverywhere = async () => {
    const list = await getAllCategories();
    setCategories(list);
    await refreshCategories();
    return list;
  };

  const doDeleteCategory = async (key: string) => {
    try {
      await deleteVideosByCategory(key);
      await refreshSeries();
    } catch (error) {
      console.error('删除分类视频失败:', error);
      notify({ message: '删除失败，请稍后重试', type: 'error' });
    } finally {
    }
  };

  // ==================== 分类配置 ====================
  const [categories, setCategories] = useState<Category[]>([]);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({
    key: '',
    name: '',
    card_layout: 'auto' as 'portrait' | 'landscape' | 'auto',
    features: { tags: true, actors: true, tracking: true, watched: true, status: true, chinese_sub: true, episode: '话' } as CategoryFeatures,
    scan_path: '' as string,
  });
  const [categoryDeleteConfirm, setCategoryDeleteConfirm] = useState<string | null>(null);
  const [scanAfterCreate, setScanAfterCreate] = useState(false);

  const loadCategories = async () => {
    try {
      await reloadCategoriesEverywhere();
    } catch (error) {
      console.error('加载分类失败:', error);
    }
  };


  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const openAddCategory = () => {
    setEditingCategory(null);
    setCategoryForm({ key: Date.now().toString(36), name: '', card_layout: 'auto', features: { tags: true, actors: true, tracking: true, watched: true, status: true, chinese_sub: true, episode: '话' }, scan_path: '' });
    setShowCategoryModal(true);
  };

  // 从其他页面跳转过来时自动打开新增分类弹窗
  useEffect(() => {
    if (searchParams.get('openCategoryModal') === 'true') {
      openAddCategory();
    }
  }, []);

  const openEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCategoryForm({ key: cat.key, name: cat.name, card_layout: cat.card_layout, features: parseCategoryFeatures(cat.features), scan_path: cat.scan_path || '' });
    setShowCategoryModal(true);
  };

  const handleSaveCategory = async () => {
    const key = categoryForm.key.trim() || Date.now().toString(36);
    if (!categoryForm.name.trim()) return;
    try {
      const featuresStr = JSON.stringify(categoryForm.features);
      const scanPath = categoryForm.scan_path.trim() || null;
      if (editingCategory) {
        await updateCategory(key, categoryForm.name, categoryForm.card_layout, featuresStr, scanPath);
      } else {
        await createCategory(key, categoryForm.name, categoryForm.card_layout, featuresStr, scanPath);
        if (scanPath) {
          setScanAfterCreate(true);
        }
      }
      setShowCategoryModal(false);
      await loadCategories();
      // 如果是从视频页跳转过来的，保存后返回视频页
      if (searchParams.get('openCategoryModal') === 'true') {
        navigate('/library');
      }
    } catch (error) {
      console.error('保存分类失败:', error);
    }
  };

  const handleScanAfterCreate = async () => {
    setScanAfterCreate(false);
    try {
      const result = await scanCategory(categoryForm.key);
      notify({ message: `扫描完成：添加了 ${result.added} 部，更新了 ${result.updated} 部`, type: 'success' });
    } catch (error) {
      console.error('扫描失败:', error);
      notify({ message: '扫描失败，请确认文件夹仍然存在并可访问', type: 'error' });
    }
  };

  const selectScanPath = async () => {
    try {
      const selected = await open({ directory: true, title: '选择扫描目录' });
      if (selected) {
        setCategoryForm({ ...categoryForm, scan_path: selected as string });
      }
    } catch (error) {
      console.error('选择文件夹失败:', error);
    }
  };

  const handleDeleteCategory = async (key: string) => {
    try {
      await deleteCategory(key);
      await loadCategories();
    } catch (error) {
      console.error('删除分类失败:', error);
    }
  };

  const handleMoveCategory = async (key: string, direction: 'up' | 'down') => {
    const idx = categories.findIndex(c => c.key === key);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === categories.length - 1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const newCategories = [...categories];
    [newCategories[idx], newCategories[swapIdx]] = [newCategories[swapIdx], newCategories[idx]];
    try {
      await reorderCategories(newCategories.map(c => c.key));
      await reloadCategoriesEverywhere();
    } catch (error) {
      console.error('分类排序失败:', error);
    }
  };

  // ==================== 演员字段管理 ====================
  const [actorFields, setActorFields] = useState<ActorField[]>([]);
  const [showFieldModal, setShowFieldModal] = useState(false);
  const [editingField, setEditingField] = useState<ActorField | null>(null);
  const [fieldForm, setFieldForm] = useState({ field_key: '', field_label: '', field_type: 'text', enabled: true, options: [] as string[] });
  const [fieldContextMenu, setFieldContextMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [newOptionValue, setNewOptionValue] = useState('');
  const [presetTemplates, setPresetTemplates] = useState<PresetTemplate[]>([]);
  const [allPresetTemplates, setAllPresetTemplates] = useState<PresetTemplate[]>([]);
  const [presetEnabledMap, setPresetEnabledMap] = useState<Record<string, boolean>>({});
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [deleteFieldConfirm, setDeleteFieldConfirm] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [gameOverlayDisabled, setGameOverlayState] = useState(false);
  const [gameOverlayLoading, setGameOverlayLoading] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ version: string; url: string; hasInstaller: boolean; body?: string; fileName?: string } | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(currentVersion);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number; percentage: number } | null>(null);
  const [downloadedFilePath, setDownloadedFilePath] = useState<string | null>(null);

  useEffect(() => {
    if (!fieldContextMenu) return;
    const close = () => setFieldContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [fieldContextMenu]);

  const loadActorFields = async () => {
    try {
      const list = await getAllActorFields();
      setActorFields(list);
    } catch (error) {
      console.error('加载演员字段失败:', error);
    }
  };

  const openEditField = (field: ActorField) => {
    setEditingField(field);
    let opts: string[] = [];
    try { if (field.options) opts = JSON.parse(field.options); } catch {}
    setFieldForm({ field_key: field.field_key, field_label: field.field_label, field_type: field.field_type, enabled: field.enabled, options: opts });
    setNewOptionValue('');
    setShowFieldModal(true);
  };

  const openAddField = () => {
    setEditingField(null);
    setFieldForm({ field_key: '', field_label: '', field_type: 'text', enabled: true, options: [] });
    setNewOptionValue('');
    setShowFieldModal(true);
  };

  // 判断是否是预设模板字段
  const isPresetField = (fieldKey: string) => allPresetTemplates.some(t => t.key === fieldKey);

  const handleSaveField = async () => {
    try {
      const label = fieldForm.field_label.trim();
      const optionsStr = fieldForm.field_type === 'select' ? JSON.stringify(fieldForm.options) : null;
      if (editingField) {
        await updateActorField(fieldForm.field_key, fieldForm.field_label, fieldForm.field_type, optionsStr, null, fieldForm.enabled);
      } else {
        // 彩蛋：输入"三围"或"罩杯"自动解锁对应扩展字段
        const easterEggMap: Record<string, string> = { '三围': 'measurements', '罩杯': 'cup_size', '身高': 'height', '体重': 'weight', '生日': 'birthday' };
        const matchedKey = easterEggMap[label];
        if (matchedKey) {
          await enablePresetTemplate(matchedKey);
        } else {
          const autoKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || Date.now().toString(36);
          await createActorField(autoKey, fieldForm.field_label, fieldForm.field_type, optionsStr, null);
        }
      }
      setShowFieldModal(false);
      loadActorFields();
    } catch (error) {
      console.error('保存演员字段失败:', error);
    }
  };

  const handleDeleteField = async (fieldKey: string) => {
    try {
      // 如果是扩展预设字段，同时禁用预设
      const extensionKeys = ['measurements', 'cup_size'];
      if (extensionKeys.includes(fieldKey)) {
        await disablePresetTemplate(fieldKey);
      }
      await deleteActorField(fieldKey);
      loadActorFields();
    } catch (error) {
      console.error('删除演员字段失败:', error);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus('检查中...');
    notify({ message: '正在检查更新...', type: 'info' });

    try {
      const release = await checkLatestRelease() as GitHubRelease;
      const latestVersion = normalizeVersion(release.tag_name);

      if (compareVersions(latestVersion, currentVersion) <= 0) {
        setUpdateStatus('已是最新版本');
        notify({ message: '已是最新版本', type: 'success' });
        setTimeout(() => setUpdateStatus(null), 5000);
        return;
      }

      const installer = findPlatformInstaller(release);
      const downloadUrl = installer?.browser_download_url || release.html_url;

      setPendingUpdate({ version: latestVersion, url: downloadUrl, hasInstaller: Boolean(installer), body: release.body || undefined, fileName: installer?.name });
      setUpdateStatus(`发现新版本 v${latestVersion}`);
      notify({ message: `检测到最新版本 v${latestVersion}`, type: 'info' });
    } catch (error) {
      console.error('检查更新失败:', error);
      setUpdateStatus('检查更新失败');
      notify({ message: '检查更新失败，请稍后重试', type: 'error' });
      setTimeout(() => setUpdateStatus(null), 5000);
    }
  };

  const handleConfirmUpdateDownload = async () => {
    if (!pendingUpdate) return;
    const update = pendingUpdate;
    setPendingUpdate(null);

    // If no installer available, fall back to opening browser
    if (!update.hasInstaller || !update.fileName) {
      setUpdateStatus(`正在打开 v${update.version} 发布页面`);
      await openExternal(update.url);
      notify({ message: '已在浏览器中打开发布页面，请手动下载更新', type: 'info' });
      setTimeout(() => setUpdateStatus(null), 8000);
      return;
    }

    // In-app download with progress
    setDownloading(true);
    setDownloadProgress({ downloaded: 0, total: 0, percentage: 0 });
    setDownloadedFilePath(null);
    setUpdateStatus(`正在下载 v${update.version} 安装包...`);

    // Listen for progress events
    const unlisten = await listen<{ downloaded: number; total: number; percentage: number }>(
      'update-download-progress',
      (event) => {
        setDownloadProgress(event.payload);
      }
    );

    try {
      const filePath = await downloadUpdate(update.url, update.fileName);
      setDownloadedFilePath(filePath);
      setUpdateStatus(`v${update.version} 下载完成`);
      notify({ message: '安装包下载完成，可点击安装', type: 'success' });
    } catch (error: any) {
      const errMsg = String(error?.message || error || '');
      if (errMsg.includes('取消')) {
        setUpdateStatus('下载已取消');
        notify({ message: '下载已取消', type: 'info' });
      } else {
        console.error('下载更新失败:', error);
        setUpdateStatus('下载失败，正在打开浏览器...');
        notify({ message: '下载失败，正在打开浏览器下载', type: 'error' });
        await openExternal(update.url);
      }
      setTimeout(() => setUpdateStatus(null), 5000);
    } finally {
      unlisten();
      setDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleCancelDownload = async () => {
    try {
      await cancelUpdateDownload();
    } catch (e) {
      console.error('取消下载失败:', e);
    }
  };

  const handleInstallUpdate = async () => {
    if (!downloadedFilePath) return;
    try {
      await installUpdate(downloadedFilePath);
      notify({ message: '正在打开安装程序...', type: 'info' });
    } catch (error) {
      console.error('打开安装包失败:', error);
      notify({ message: '打开安装包失败', type: 'error' });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500 flex items-center gap-2"><img src={loadingIcon} alt="加载中" className="w-6 h-6 animate-spin" /></div>
      </div>
    );
  }

  return (
    <div className="changli-page">
      <div className="changli-page-header">
        <h1 className="changli-heading-xl">设置</h1>
      </div>

      {/* 数据存储 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">数据存储</h2>
            <p className="text-sm text-gray-500 mt-1">
              管理视频数据和缓存的存储位置
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRepairMissingPosters}
              disabled={posterRepairStatus.status === 'running'}
              className="action-btn action-btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {posterRepairStatus.status === 'running' ? '更新中...' : '批量更新海报'}
            </button>
            <button
              onClick={() => openDataDir()}
              className="action-btn action-btn-primary"
            >
              打开数据目录
            </button>
          </div>
        </div>

        <div className="changli-panel p-6 space-y-4">
          {posterRepairStatus.status !== 'idle' && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 w-24">海报更新进度</span>
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${posterRepairStatus.status === 'running' ? 'bg-amber-50 text-amber-700' : posterRepairStatus.status === 'success' ? 'bg-emerald-50 text-emerald-700' : posterRepairStatus.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                {posterRepairStatus.status === 'running' && `更新中，已检查 ${posterRepairStatus.scanned_series} 个视频集，已更新 ${posterRepairStatus.updated_series} 个`}
                {posterRepairStatus.status === 'success' && `更新成功，已更新 ${posterRepairStatus.updated_series} 个视频集海报`}
                {posterRepairStatus.status === 'error' && `更新失败：${posterRepairStatus.error || '未知错误'}`}
              </span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 w-24">当前模式</span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-sm text-gray-800">
              {storageInfo?.mode === 'portable' ? '便携模式' : '系统数据目录'}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-sm text-gray-500 w-24 shrink-0">数据目录</span>
            <code className="text-sm text-gray-800 break-all bg-gray-50 px-3 py-2 rounded-lg flex-1">
              {storageInfo?.data_dir || '加载中...'}
            </code>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-sm text-gray-500 w-24 shrink-0">数据库</span>
            <code className="text-sm text-gray-800 break-all bg-gray-50 px-3 py-2 rounded-lg flex-1">
              {storageInfo?.db_path || '加载中...'}
            </code>
          </div>
        </div>
      </section>


      {/* 游戏覆盖 — 仅 Windows */}
      {(navigator.platform.includes('Win') || navigator.userAgent.includes('Windows')) && (
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">游戏覆盖</h2>
            <p className="text-sm text-gray-500 mt-1">防止录屏软件干扰视频播放</p>
          </div>
        </div>
        <div className="changli-panel p-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-gray-700">禁用游戏覆盖</span>
              <p className="text-xs text-gray-400 mt-0.5">写入系统注册表禁用 Game DVR/GameBar，如已安装 NVIDIA Profile Inspector 会自动导入配置</p>
            </div>
            <Switch
            checked={gameOverlayDisabled}
            disabled={gameOverlayLoading}
            onChange={async (checked) => {
              setGameOverlayLoading(true);
              try {
                await setGameOverlayDisabled(checked);
                setGameOverlayState(checked);
                notify({ message: checked ? '已禁用游戏覆盖' : '已启用游戏覆盖', type: 'success' });
              } catch (error) {
                notify({ message: '操作失败，请稍后重试', type: 'error' });
              } finally {
                setGameOverlayLoading(false);
              }
            }}
            ariaLabel="禁用游戏覆盖"
          />
          </div>
        </div>
      </section>
      )}


      {/* 网站管理 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">网站管理</h2>
            <p className="text-sm text-gray-500 mt-1">配置视频来源网站</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="action-btn action-btn-primary"
          >
            添加网站
          </button>
        </div>
        
        {sites.length > 0 ? (
          <div className="space-y-4">
            {sites.map((site) => (
              <div key={site.id} className="changli-panel p-6 transition-transform duration-200 hover:-translate-y-0.5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{site.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">{site.url}</p>
                    <p className="text-xs text-gray-400 mt-1">解析器: {site.parser_type}</p>
                  </div>
                  <button
                    onClick={() => requestSecondConfirm(`site-${site.id}`, () => handleDeleteSite(site.id))}
                    className="action-btn action-btn-danger text-sm"
                  >
                    {pendingKey === `site-${site.id}` ? '再次确认删除' : '删除'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="changli-empty-state">
            <p className="text-gray-500 mb-4">暂无网站配置</p>
            <p className="text-gray-400 text-sm">添加网站后可以搜索在线资源</p>
          </div>
        )}
      </section>


      {/* 分类配置 */}
      <section className="mb-12" data-tutorial="settings-categories">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">分类配置</h2>
            <p className="text-sm text-gray-500 mt-1">自定义视频分类的显示方式和功能</p>
          </div>
          <button
            onClick={openAddCategory}
            className="action-btn action-btn-primary"
          >
            新增分类
          </button>
        </div>

        {categories.length > 0 ? (
          <div className="space-y-4">
            {categories.map((cat) => {
              const features = parseCategoryFeatures(cat.features);
              const layoutLabel = cat.card_layout === 'portrait' ? '竖版' : cat.card_layout === 'landscape' ? '横版' : '自动';
              const activeFeatures = Object.entries(features).filter(([k, v]) => v && k !== 'episode').map(([k]) => {
                const labels: Record<string, string> = { tracking: '追番标记', watched: '观影进度', status: '连载状态', tags: '标签', actors: '演员', chinese_sub: '中字' };
                const colors: Record<string, string> = { tracking: 'bg-blue-50 text-blue-700', watched: 'bg-amber-50 text-amber-700', status: 'bg-emerald-50 text-emerald-700', tags: 'bg-purple-50 text-purple-700', actors: 'bg-pink-50 text-pink-700', chinese_sub: 'bg-orange-50 text-orange-700' };
                return { label: labels[k] || k, color: colors[k] || 'bg-gray-50 text-gray-700' };
              });
              return (
                <div key={cat.key} className="changli-panel p-6 transition-transform duration-200 hover:-translate-y-0.5">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                      <p className="text-sm text-gray-500 mt-1">卡片方向: {layoutLabel} · 集数称呼: {features.episode || '部'}</p>
                      {cat.scan_path && (
                        <p className="text-xs text-gray-400 mt-1 truncate">扫描路径: {cat.scan_path}</p>
                      )}
                      {activeFeatures.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {activeFeatures.map((f) => (
                            <span key={f.label} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${f.color}`}>{f.label}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => handleMoveCategory(cat.key, 'up')}
                        disabled={categories.indexOf(cat) === 0}
                        className="action-btn text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        title="上移"
                      >▲ 上移</button>
                      <button
                        onClick={() => handleMoveCategory(cat.key, 'down')}
                        disabled={categories.indexOf(cat) === categories.length - 1}
                        className="action-btn text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                        title="下移"
                      >▼ 下移</button>
                      <button
                        onClick={() => openEditCategory(cat)}
                        className="action-btn action-btn-primary"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setDeleteCatConfirm(cat.key)}
                        className="action-btn action-btn-danger text-sm"
                      >
                        删除所有视频
                      </button>
                      <button
                        onClick={() => setCategoryDeleteConfirm(cat.key)}
                        className="action-btn action-btn-danger text-sm"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="changli-empty-state">
            <p className="text-gray-500 mb-4">暂无分类配置</p>
            <p className="text-gray-400 text-sm">点击"新增分类"添加</p>
          </div>
        )}
      </section>


      {/* 标签管理 */}
      <section className="mb-12" data-tutorial="settings-tags">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">标签管理</h2>
            <p className="text-sm text-gray-500 mt-1">管理视频标签，方便筛选和分类</p>
          </div>
        </div>

        <div className="changli-panel p-6 mb-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAddTag();
              }}
              placeholder="输入新标签名称"
              className="search-input flex-1"
            />
            <button
              onClick={handleAddTag}
              disabled={!newTagName.trim()}
              className="action-btn action-btn-primary disabled:opacity-50"
            >
              添加标签
            </button>
          </div>
        </div>

        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {tags.map((tag) => (
              <div key={tag.id} className={`inline-flex items-center gap-2 px-4 py-2 ${getTagColor(tag.id).bg} rounded-full`}>
                {editingTag?.id === tag.id ? (
                  <input
                    type="text"
                    value={editingTagValue}
                    onChange={(e) => setEditingTagValue(e.target.value)}
                    onBlur={handleSaveTagEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveTagEdit();
                      if (e.key === 'Escape') setEditingTag(null);
                    }}
                    className="bg-transparent border-none outline-none text-sm text-gray-800 w-20"
                    autoFocus
                  />
                ) : (
                  <span
                    className="text-sm text-gray-800 cursor-pointer select-none"
                    onDoubleClick={() => {
                      setEditingTag(tag);
                      setEditingTagValue(tag.name);
                    }}
                    title="双击编辑标签名称"
                  >
                    {tag.name}
                  </span>
                )}
                <button
                  onClick={() => requestSecondConfirm(`settings-tag-${tag.id}`, () => handleDeleteTag(tag.id))}
                  className="text-gray-400 hover:text-red-500"
                  aria-label={`删除标签 ${tag.name}`}
                >
                  {pendingKey === `settings-tag-${tag.id}` ? '确认' : '✕'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="changli-empty-state text-gray-500">暂无标签</div>
        )}
      </section>


      {/* 演员配置 */}
      <section className="mb-12" data-tutorial="settings-actors">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">演员配置</h2>
            <p className="text-sm text-gray-500 mt-1">自定义演员详情页显示的信息</p>
          </div>
          <div className="flex gap-2">
            {/* 扩展系统预设已隐藏为彩蛋：新增字段时输入"三围"或"罩杯"自动解锁 */}
          </div>
        </div>

        {(() => {
          const presetKeySet = new Set(allPresetTemplates.map(t => t.key));
          const extensionPresetKeySet = new Set(presetTemplates.map(t => t.key));
          const sorted = [...actorFields.filter(f => {
            if (f.field_key === 'name') return false;
            if (extensionPresetKeySet.has(f.field_key) && !f.enabled) return false;
            return true;
          })].sort((a, b) => {
            const aPreset = presetKeySet.has(a.field_key) ? 0 : 1;
            const bPreset = presetKeySet.has(b.field_key) ? 0 : 1;
            return aPreset - bPreset;
          });
          return (
            <div className="grid grid-cols-4 gap-4">
              {sorted.map((field) => (
                <div key={field.field_key} className="changli-panel p-4 cursor-pointer flex flex-col items-center justify-center transition-transform duration-200 hover:-translate-y-0.5" onClick={() => openEditField(field)} onContextMenu={(e) => { e.preventDefault(); setFieldContextMenu({ key: field.field_key, x: e.clientX, y: e.clientY }); }}>
                  <h3 className="font-semibold text-gray-900 text-sm">{field.field_label}</h3>
                  {presetKeySet.has(field.field_key) && !extensionPresetKeySet.has(field.field_key) && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-rose-50 text-[10px] text-rose-700 mt-1">系统预设</span>
                  )}
                  {extensionPresetKeySet.has(field.field_key) && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-50 text-[10px] text-blue-700 mt-1">扩展预设</span>
                  )}
                  {!presetKeySet.has(field.field_key) && !extensionPresetKeySet.has(field.field_key) && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-green-50 text-[10px] text-green-700 mt-1">自定义</span>
                  )}
                  <p className="text-xs text-gray-500 mt-1">{field.field_type === 'text' ? '文本' : field.field_type === 'number' ? '数字' : field.field_type === 'date' ? '日期' : field.field_type === 'compound' ? '复合' : '选择'}</p>
                  <p className="text-xs mt-1">{field.enabled ? <span className="text-green-600">● 启用</span> : <span className="text-gray-400">○ 未启用</span>}</p>
                </div>
              ))}
              <button
                type="button"
                onClick={openAddField}
                className="min-h-[118px] rounded-2xl border-2 border-dashed border-gray-300 bg-white/58 p-4 text-gray-500 transition-all duration-200 hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-50/40 hover:text-rose-500"
              >
                <span className="block text-3xl leading-none">+</span>
                <span className="mt-2 block text-sm font-semibold">新增字段</span>
              </button>
            </div>
          );
        })()}
      </section>



      {/* 分类视频删除确认弹窗 */}
      {deleteCatConfirm && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel">
            <p className="text-gray-900 text-base mb-6">
              确定要删除「{categories.find(c => c.key === deleteCatConfirm)?.name || deleteCatConfirm}」下的所有视频吗？此操作不可恢复。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { doDeleteCategory(deleteCatConfirm); setDeleteCatConfirm(null); }}
                className="action-btn action-btn-danger flex-1 text-sm"
              >
                狠心删除
              </button>
              <button
                onClick={() => setDeleteCatConfirm(null)}
                className="action-btn flex-1 text-sm"
              >
                返回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加网站弹窗 */}
      {showAddModal && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel">
            <h2 className="changli-modal-title">添加网站</h2>
            <div className="space-y-4">
              <div>
                <label className="changli-form-label">网站名称</label>
                <input
                  type="text"
                  value={newSite.name}
                  onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
                  className="changli-input"
                  placeholder="如：动漫之家"
                />
              </div>
              <div>
                <label className="changli-form-label">网站地址</label>
                <input
                  type="text"
                  value={newSite.url}
                  onChange={(e) => setNewSite({ ...newSite, url: e.target.value })}
                  className="changli-input"
                  placeholder="https://www.example.com"
                />
              </div>
              <div>
                <label className="changli-form-label">解析器类型</label>
                <select
                  value={newSite.parser_type}
                  onChange={(e) => setNewSite({ ...newSite, parser_type: e.target.value })}
                  className="changli-input"
                >
                  <option value="auto">自动检测</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setShowAddModal(false)}
                className="action-btn flex-1"
              >
                取消
              </button>
              <button
                onClick={handleAddSite}
                className="action-btn action-btn-primary flex-1"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分类编辑/新增弹窗 */}
      {showCategoryModal && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel max-h-[90vh] !w-[min(100%,520px)] overflow-y-auto" data-tutorial="category-modal">
            <h2 className="changli-modal-title">{editingCategory ? '编辑分类' : '新增分类'}</h2>
            <div className="space-y-4">
              <div>
                <label className="changli-form-label">分类名称</label>
                <input
                  type="text"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="changli-input"
                  placeholder="如：动漫"
                />
              </div>
              {/* Key 不展示，由系统管理 */}
              <div>
                <label className="changli-form-label">默认扫描路径</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={categoryForm.scan_path}
                    onChange={(e) => setCategoryForm({ ...categoryForm, scan_path: e.target.value })}
                    className="changli-input flex-1"
                    placeholder="留空则不启用一键扫描"
                  />
                  <button
                    type="button"
                    onClick={selectScanPath}
                    className="action-btn text-sm"
                  >
                    选择文件夹
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 flex-1">
                  <label className="changli-form-label whitespace-nowrap mb-0">卡片方向</label>
                  <BubbleSelect
                    value={categoryForm.card_layout}
                    options={[{ value: 'auto', label: '自动' }, { value: 'portrait', label: '竖版' }, { value: 'landscape', label: '横版' }]}
                    onChange={(v) => setCategoryForm({ ...categoryForm, card_layout: v as 'portrait' | 'landscape' | 'auto' })}
                  />
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <label className="changli-form-label whitespace-nowrap mb-0">集数称呼</label>
                  <BubbleSelect
                    value={categoryForm.features.episode || '部'}
                    options={[{ value: '话', label: '话' }, { value: '部', label: '部' }, { value: '集', label: '集' }]}
                    onChange={(v) => setCategoryForm({
                      ...categoryForm,
                      features: { ...categoryForm.features, episode: v }
                    })}
                  />
                </div>
              </div>
              <div>
                <label className="changli-form-label">功能开关</label>
                <div className="space-y-3">
                  {([
                    { key: 'tracking' as const, label: '追番标记', tip: '控制是否支持追番标记功能' },
                    { key: 'watched' as const, label: '观影进度', tip: '控制是否支持标记已看完/未看完功能' },
                    { key: 'status' as const, label: '连载状态', tip: '控制是否显示连载中/已完结状态' },
                    { key: 'tags' as const, label: '标签', tip: '控制是否支持给视频集添加标签分类' },
                    { key: 'actors' as const, label: '演员', tip: '控制是否支持给视频集关联演员' },
                    { key: 'chinese_sub' as const, label: '中文字幕', tip: '控制是否支持中文字幕标记' },
                  ]).map(({ key, label, tip }) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{label}</span>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!!categoryForm.features[key]}
                          onChange={(checked) => setCategoryForm({
                            ...categoryForm,
                            features: { ...categoryForm.features, [key]: checked }
                          })}
                          ariaLabel={`${label}开关`}
                        />
                        <span className="group relative">
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs cursor-help">?</span>
                          <span className="changli-tooltip absolute bottom-full right-0 mb-2 px-3 py-1.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">{tip}</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => {
                  setShowCategoryModal(false);
                  if (searchParams.get('openCategoryModal') === 'true') {
                    navigate('/library');
                  }
                }}
                className="action-btn flex-1"
              >
                取消
              </button>
              <button
                onClick={handleSaveCategory}
                disabled={!categoryForm.key.trim() || !categoryForm.name.trim()}
                className="action-btn action-btn-primary flex-1 disabled:opacity-50"
              >
                {editingCategory ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分类删除确认弹窗 */}
      {categoryDeleteConfirm && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel">
            <p className="mb-6 text-base text-gray-900">
              确定要删除分类「{categories.find(c => c.key === categoryDeleteConfirm)?.name || categoryDeleteConfirm}」吗？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { handleDeleteCategory(categoryDeleteConfirm); setCategoryDeleteConfirm(null); }}
                className="action-btn action-btn-danger flex-1 text-sm"
              >
                确认删除
              </button>
              <button
                onClick={() => setCategoryDeleteConfirm(null)}
                className="action-btn flex-1 text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 演员字段编辑/新增弹窗 */}
      {showFieldModal && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel">
            <h2 className="changli-modal-title">{editingField ? '编辑字段' : '新增字段'}</h2>
            <div className="space-y-4">
              <div>
                <label className="changli-form-label">字段名称</label>
                <input
                  type="text"
                  value={fieldForm.field_label}
                  onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })}
                  className="changli-input"
                  placeholder="如：身高"
                />
              </div>
              {!(editingField && isPresetField(editingField.field_key)) && (
                <>
              <div>
                <label className="changli-form-label">字段类型</label>
                <BubbleSelect
                  value={fieldForm.field_type}
                  options={[
                    { value: 'text', label: '文本' },
                    { value: 'number', label: '数字' },
                    { value: 'date', label: '日期' },
                    { value: 'select', label: '选择' },
                  ]}
                  onChange={(v) => setFieldForm({ ...fieldForm, field_type: v })}
                />
              </div>

              {editingField && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">启用</span>
                  <Switch
                    checked={fieldForm.enabled}
                    onChange={(checked) => setFieldForm({ ...fieldForm, enabled: checked })}
                    ariaLabel="演员字段启用开关"
                  />
                </div>
              )}
              {fieldForm.field_type === 'select' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">选项配置</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(fieldForm.options || []).map((opt, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-sm">
                        {opt}
                        <button onClick={() => { const newOpts = [...(fieldForm.options || [])]; newOpts.splice(i, 1); setFieldForm({ ...fieldForm, options: newOpts }); }} className="text-gray-400 hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={newOptionValue} onChange={(e) => setNewOptionValue(e.target.value)} placeholder="新选项" className="flex-1 px-3 py-2 border rounded-lg" onKeyDown={(e) => { if (e.key === 'Enter' && newOptionValue.trim()) { setFieldForm({ ...fieldForm, options: [...(fieldForm.options || []), newOptionValue.trim()] }); setNewOptionValue(''); } }} />
                    <button onClick={() => { if (newOptionValue.trim()) { setFieldForm({ ...fieldForm, options: [...(fieldForm.options || []), newOptionValue.trim()] }); setNewOptionValue(''); } }} className="px-3 py-2 bg-gray-100 rounded-lg">添加</button>
                  </div>
                </div>
              )}
                </>
              )}
              {editingField && isPresetField(editingField.field_key) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">启用</span>
                  <Switch
                    checked={fieldForm.enabled}
                    onChange={(checked) => setFieldForm({ ...fieldForm, enabled: checked })}
                    ariaLabel="演员字段启用开关"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setShowFieldModal(false)}
                className="action-btn flex-1"
              >
                取消
              </button>
              <button
                onClick={handleSaveField}
                disabled={!fieldForm.field_label.trim()}
                className="action-btn action-btn-primary flex-1 disabled:opacity-50"
              >
                {editingField ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 演员字段右键菜单 */}
      {fieldContextMenu && (
        <div className="fixed z-50 bg-white border rounded-xl shadow-xl py-2 w-fit" style={{ left: fieldContextMenu.x + 160 > window.innerWidth ? fieldContextMenu.x - 160 : fieldContextMenu.x, top: fieldContextMenu.y + 200 > window.innerHeight ? fieldContextMenu.y - 200 : fieldContextMenu.y }}>
          <button onClick={() => { openEditField(actorFields.find(f => f.field_key === fieldContextMenu.key)!); setFieldContextMenu(null); }} className="changli-menu-item">编辑</button>
          <button onClick={() => { setDeleteFieldConfirm(fieldContextMenu.key); setFieldContextMenu(null); }} className="changli-menu-item changli-menu-item-danger">删除</button>
        </div>
      )}


      {/* 演员字段删除确认弹窗 */}
      {deleteFieldConfirm && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel">
            <p className="text-gray-900 text-base mb-6">
              确定删除该字段？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { handleDeleteField(deleteFieldConfirm); setDeleteFieldConfirm(null); }}
                className="action-btn action-btn-danger flex-1 text-sm"
              >
                确认删除
              </button>
              <button
                onClick={() => setDeleteFieldConfirm(null)}
                className="action-btn flex-1 text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 扩展系统预设弹窗 */}
      {showPresetModal && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel !w-[min(100%,480px)]">
            <h2 className="text-xl font-bold mb-4">扩展系统预设</h2>
            <p className="text-sm text-gray-500 mb-4">启用后将在演员配置中显示对应字段</p>
            <div className="space-y-3">
              {presetTemplates.map((template) => {
                const enabled = presetEnabledMap[template.key] || false;
                return (
                  <div key={template.key} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-[#f8f9fc] p-3">
                    <div>
                      <span className="text-sm font-medium text-gray-900">{actorFields.find(f => f.field_key === template.key)?.field_label || template.name}</span>
                    </div>
                    <Switch
                      checked={enabled}
                      onChange={async (checked) => {
                        try {
                          if (checked) {
                            await enablePresetTemplate(template.key);
                          } else {
                            await disablePresetTemplate(template.key);
                          }
                          // 刷新
                          const fieldsList = await getAllActorFields();
                          setActorFields(fieldsList);
                          const map: Record<string, boolean> = {};
                          for (const t of presetTemplates) {
                            map[t.key] = fieldsList.some((f: ActorField) => f.field_key === t.key && f.enabled);
                          }
                          setPresetEnabledMap(map);
                        } catch (error) {
                          console.error('切换预设模板失败:', error);
                        }
                      }}
                      ariaLabel={`${template.name}预设开关`}
                    />
                  </div>
                );
              })}
              {presetTemplates.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">暂无扩展预设</p>
              )}
            </div>
            <div className="mt-6">
              <button
                onClick={() => setShowPresetModal(false)}
                className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增分类后立即扫描确认弹窗 */}
      {scanAfterCreate && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel">
            <p className="text-gray-900 text-base mb-6">
              分类已创建，是否立即扫描并添加？
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleScanAfterCreate}
                className="action-btn action-btn-primary flex-1 text-sm"
              >
                立即扫描
              </button>
              <button
                onClick={() => setScanAfterCreate(false)}
                className="action-btn flex-1 text-sm"
              >
                稍后再说
              </button>
            </div>
          </div>
        </div>
      )}



      {/* 检查更新 & 版本信息 */}
      <section className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">关于</h2>
            <p className="text-sm text-gray-500 mt-1">当前版本：v{currentVersion}</p>
          </div>
          <div className="flex gap-2 items-center" data-tutorial="settings-about">
            {updateStatus && (
              <span className="text-sm text-gray-500">{updateStatus}</span>
            )}
            <button
              onClick={() => {
                localStorage.removeItem('changli_onboarding_done');
                navigate('/');
                // 通过自定义事件触发教程启动，不刷新页面
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('start-onboarding'));
                }, 100);
              }}
              className="action-btn"
            >
              新手引导
            </button>
            <button
              onClick={handleCheckUpdate}
              disabled={updateStatus === '检查中...'}
              className="action-btn action-btn-primary disabled:opacity-50"
            >
              检查更新
            </button>
            <button
              onClick={() => setShowChangelog(true)}
              className="action-btn"
            >
              版本更新记录
            </button>
            <button
              onClick={async () => {
                const count = await cleanupOldInstallers();
                notify({ message: count > 0 ? `已清理 ${count} 个旧安装包` : '没有发现旧安装包', type: count > 0 ? 'success' : 'info' });
              }}
              className="action-btn"
            >
              清理旧安装包
            </button>
          </div>
        </div>
      </section>


      {/* 版本更新记录弹窗 */}
      {showChangelog && (
        <div className="changli-modal-backdrop">
          <div className="changli-modal-panel !w-[min(100%,720px)] max-h-[85vh] flex flex-col !p-0">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="changli-modal-title">版本更新记录</h2>
              <button onClick={() => setShowChangelog(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-2">
              {changelogData.map((entry) => {
                const isCurrent = entry.version === currentVersion;
                const isExpanded = expandedVersion === entry.version;
                return (
                  <div key={entry.version} className={`rounded-2xl border ${isCurrent ? 'border-rose-200 bg-rose-50/70' : 'border-gray-200 bg-white/70'}`}>
                    <button
                      onClick={() => setExpandedVersion(isExpanded ? null : entry.version)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/70 rounded-2xl transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`font-semibold text-sm ${isCurrent ? 'text-rose-700' : 'text-gray-900'}`}>v{entry.version}</span>
                        <span className="text-xs text-gray-500">{entry.date}</span>
                        {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-[#fb5b7b] to-[#ff8a4c] text-white">当前</span>}
                      </div>
                      <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-3">
                        {entry.changes.map((group, gi) => (
                          <div key={gi}>
                            <p className="text-xs font-semibold text-gray-500 mb-1">{group.category}</p>
                            <ul className="space-y-1">
                              {group.items.map((item, ii) => (
                                <li key={ii} className="text-sm text-gray-700 flex items-start gap-2">
                                  <span className="text-gray-400 mt-0.5">•</span>
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingUpdate || downloading || !!downloadedFilePath}
        title={downloading ? '下载更新' : downloadedFilePath ? '安装更新' : '检测到新版本'}
        message={
          downloading && downloadProgress ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">正在下载安装包...</p>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${downloadProgress.percentage.toFixed(1)}%`,
                    background: 'linear-gradient(90deg, #fb5b7b, #ff8a4c)',
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{downloadProgress.percentage.toFixed(1)}%</span>
                <span>
                  {formatBytes(downloadProgress.downloaded)}
                  {downloadProgress.total > 0 ? ` / ${formatBytes(downloadProgress.total)}` : ''}
                </span>
              </div>
            </div>
          ) : downloadedFilePath ? (
            <div>
              <p className="mb-2">安装包已下载完成，点击安装按钮打开安装程序。</p>
              <p className="text-xs text-gray-500">安装前请关闭当前应用</p>
            </div>
          ) : pendingUpdate ? (
            <div>
              <p className="mb-3">检测到最新版本 v{pendingUpdate.version}，是否下载更新？</p>
              {pendingUpdate.body && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg max-h-60 overflow-y-auto">
                  <p className="text-xs font-medium text-gray-500 mb-2">更新内容：</p>
                  <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                    {pendingUpdate.body}
                  </div>
                </div>
              )}
            </div>
          ) : ''
        }
        confirmText={downloading ? '取消下载' : downloadedFilePath ? '立即安装' : '下载更新'}
        cancelText={downloading ? '' : downloadedFilePath ? '稍后' : '取消'}
        onConfirm={downloading ? handleCancelDownload : downloadedFilePath ? handleInstallUpdate : handleConfirmUpdateDownload}
        onCancel={() => {
          if (downloading) {
            handleCancelDownload();
          }
          setPendingUpdate(null);
          setDownloading(false);
          setDownloadProgress(null);
          setDownloadedFilePath(null);
          setUpdateStatus(null);
        }}
      />


    </div>
  );
};

export default Settings;
