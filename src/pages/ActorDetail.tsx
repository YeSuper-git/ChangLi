import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { getActor, getActorResources, updateActor, saveActorPhoto, scanVideosForActor, deleteVideo, deleteVideoSeries, getActorPeriods, addActorPeriod, updateActorPeriod, deleteActorPeriod, reorderActorPeriods, getActorWorkPeriodMap, rescanSingleSeriesMetadata, getActorPhotos, addActorPhoto, deleteActorPhoto, setPrimaryPhoto, reorderActorPhotos } from '../utils/api';
import type { Actor, Video, ActorPeriod, ActorPhoto } from '../utils/api';
import { open } from '@tauri-apps/api/dialog';
import { actorPhotoDataUrl, SmartPoster, StaticImagePlaceholder, videoPosterDataUrl } from '../utils/media';

import { useSecondConfirm } from '../utils/useSecondConfirm';
import backIcon from '../assets/icons/back.svg';
import loadingIcon from '../assets/icons/loading.svg';

const ActorDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pendingKey, requestSecondConfirm, clearPending } = useSecondConfirm();
  const [contextMenu, setContextMenu] = useState<{ type: 'video' | 'series'; id: number; name: string; x: number; y: number } | null>(null);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editFromUrl = searchParams.get('edit') === '1';
  const clearEditQuery = () => {
    if (editFromUrl) {
      navigate(location.pathname, { replace: true, state: location.state });
    }
  };
  const [actor, setActor] = useState<Actor | null>(null);
  const [resources, setResources] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    bio: '',
    birthday: '',
    height: '',
    measurements: '',
    japanese_name: '',
    cup_size: '',
    alias: '',
  });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photos, setPhotos] = useState<ActorPhoto[]>([]);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [photoContextMenu, setPhotoContextMenu] = useState<{ photoId: number; x: number; y: number } | null>(null);
  const [addingWork, setAddingWork] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
  const [periods, setPeriods] = useState<ActorPeriod[]>([]);
  const [workPeriodMap, setWorkPeriodMap] = useState<Record<string, number>>({});
  // 时期右键菜单
  const [periodContextMenu, setPeriodContextMenu] = useState<{ periodId: number; x: number; y: number } | null>(null);
  // 时期编辑
  const [editingPeriodId, setEditingPeriodId] = useState<number | null>(null);
  const [editingPeriodName, setEditingPeriodName] = useState('');
  // 时期删除确认
  const [deletingPeriodId, setDeletingPeriodId] = useState<number | null>(null);
  // 添加时期
  const [showAddPeriodModal, setShowAddPeriodModal] = useState(false);
  const [newPeriodName, setNewPeriodName] = useState('');
  // 添加作品时选择时期弹窗
  const [periodSelectVisible, setPeriodSelectVisible] = useState(false);

  const measureRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);

  useEffect(() => {
    if (id) {
      loadActor(parseInt(id));
    }
  }, [id]);

  // Toast 自动消失
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (editFromUrl && actor) {
      setEditing(true);
    }
  }, [editFromUrl, actor]);
  useEffect(() => {
    const closeMenu = () => { setContextMenu(null); setPhotoContextMenu(null); setPeriodContextMenu(null); clearPending(); setDeletingPeriodId(null); };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);


  const loadActor = async (actorId: number) => {
    try {
      console.log('[Actor] 开始加载演员详情, actorId:', actorId);
      const [actorData, resourcesData, periodsData, periodMap, photosData] = await Promise.all([
        getActor(actorId),
        getActorResources(actorId),
        getActorPeriods(actorId),
        getActorWorkPeriodMap(actorId),
        getActorPhotos(actorId),
      ]);
      console.log('[Actor] getActor 返回:', actorData ? `name: ${actorData.name}, photo: ${actorData.photo || '无'}` : 'null');
      console.log('[Actor] getActorResources 返回:', resourcesData.length, '条');
      setActor(actorData);
      setResources(resourcesData);
      setPeriods(periodsData);
      setWorkPeriodMap(periodMap);
      setPhotos(photosData);
      setCurrentPhotoIndex(0);
      if (actorData) {
        setEditForm({
          name: actorData.name,
          bio: actorData.bio || '',
          birthday: actorData.birthday || '',
          height: actorData.height || '',
          measurements: actorData.measurements || '',
          japanese_name: actorData.japanese_name || '',
          cup_size: actorData.cup_size || '',
          alias: actorData.alias || '',
        });
      }
    } catch (error) {
      console.error('[Actor] 加载演员详情失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!actor || !editForm.name.trim()) return;
    
    try {
      await updateActor(
        actor.id,
        editForm.name,
        actor.photo,
        editForm.bio || undefined,
        editForm.birthday ? normalizeBirthday(editForm.birthday) : undefined,
        editForm.height || undefined,
        editForm.measurements || undefined,
        editForm.japanese_name || undefined,
        editForm.cup_size || undefined,
        editForm.alias || undefined
      );
      clearEditQuery();
      setEditing(false);
      loadActor(actor.id);
    } catch (error) {
      console.error('[Actor] 更新演员失败:', error);
    }
  };

  // handlePhotoClick 已移除：编辑态点击海报改为调用 handleAddPhoto 添加新海报，不覆盖主海报


  // 添加作品：如果没有时期，直接打开文件夹；有时期，弹出选择弹窗
  const handleAddWork = async () => {
    if (periods.length > 0) {
      // 有新增时期，弹出选择弹窗
      setPeriodSelectVisible(true);
    } else {
      // 没有新增时期，直接打开文件夹
      await doAddWork(undefined);
    }
  };

  const doAddWork = async (selectedPeriodId: number | undefined) => {
    try {
      console.log('[ActorDetail] 打开文件夹选择器...');
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择包含视频的文件夹'
      });
      
      if (selected && actor) {
        console.log('[ActorDetail] 选择的文件夹:', selected);
        setAddingWork(true);
        try {
          console.log('[ActorDetail] 开始扫描视频...');
          const result = await scanVideosForActor(selected as string, actor.id, selectedPeriodId);
          
          // 刷新资源列表
          loadActor(actor.id);

          // 显示扫描结果
          const { added, updated } = result;
          if (added > 0 && updated > 0) {
            setToast({ message: `添加成功，本次添加了 ${added} 部作品，更新了 ${updated} 部已有作品`, type: 'success' });
          } else if (added > 0) {
            setToast({ message: `添加成功，本次添加了 ${added} 部作品`, type: 'success' });
          } else if (updated > 0) {
            setToast({ message: `更新了 ${updated} 部已有作品`, type: 'info' });
          } else {
            setToast({ message: '未发现新作品', type: 'info' });
          }
        } catch (error) {
          console.error('[Actor] 添加作品失败:', error);
          setToast({ message: '请添加该演员对应的视频哦', type: 'info' });
        } finally {
          setAddingWork(false);
        }
      }
    } catch (error) {
      console.error('[Actor] 打开文件夹选择器失败:', error);
    }
  };

  const openContextMenu = (event: React.MouseEvent, type: 'video' | 'series', id: number, name: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ type, id, name, x: event.clientX, y: event.clientY });
  };

  const handleEditContextItem = () => {
    if (!contextMenu) return;
    const target = contextMenu.type === 'video'
      ? `/video/${contextMenu.id}?edit=1`
      : `/series/${contextMenu.id}?edit=1`;
    setContextMenu(null);
    clearPending();
    navigate(target, { state: { from: `/actors/${actor?.id}`, backLabel: '返回演员详情' } });
  };

  const handleDeleteVideo = async (id: number) => {
    try {
      await deleteVideo(id);
      setContextMenu(null);
      if (actor) loadActor(actor.id);
    } catch (error) {
      console.error('[Actor] 删除视频失败:', error);
      alert('删除失败: ' + String(error));
    }
  };

  const handleDeleteSeries = async (id: number) => {
    try {
      await deleteVideoSeries(id, true);
      setContextMenu(null);
      if (actor) loadActor(actor.id);
    } catch (error) {
      console.error('[Actor] 删除视频集失败:', error);
      alert('删除失败: ' + String(error));
    }
  };

  const handleRescanMetadata = async (seriesId: number) => {
    try {
      const matched = await rescanSingleSeriesMetadata(seriesId);
      setContextMenu(null);
      clearPending();
      if (actor) loadActor(actor.id);
      setToast({ message: matched ? '元数据更新成功' : '未匹配到格式，未更新', type: matched ? 'success' : 'info' });
    } catch (error) {
      console.error('[Actor] 重新扫描元数据失败:', error);
      setToast({ message: '重新扫描失败: ' + String(error), type: 'info' });
    }
  };

  // 辅助函数
  const getMaxDay = (month: number): number => {
    if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
    if ([4, 6, 9, 11].includes(month)) return 30;
    if (month === 2) return 29;
    return 31;
  };

  const bParts = (editForm.birthday || '').split('-');
  while (bParts.length < 3) bParts.push('');
  const maxDay = getMaxDay(parseInt(bParts[1], 10) || 0);

  const numOrEmpty = (s: string): number | '' => {
    const n = parseInt(s, 10);
    return isNaN(n) ? '' : n;
  };

  const updateBirthday = (idx: number, val: string) => {
    const parts = (editForm.birthday || '').split('-');
    while (parts.length < 3) parts.push('');
    parts[idx] = val;
    setEditForm({ ...editForm, birthday: parts.join('-') });
  };

  const measureParts = (editForm.measurements || '').split('-');
  while (measureParts.length < 3) measureParts.push('');

  const handleMeasureChange = (index: number, value: string) => {
    const digits = value.replace(/\D/g, '');
    const parts = (editForm.measurements || '').split('-');
    while (parts.length < 3) parts.push('');
    let maxLen = 2;
    if (digits.length > 0 && digits[0] === '1') maxLen = 3;
    const clamped = digits.slice(0, maxLen);
    parts[index] = clamped;
    setEditForm({ ...editForm, measurements: parts.join('-') });
  };

  const normalizeBirthday = (bd: string): string => {
    const parts = bd.split('-');
    if (parts.length !== 3) return bd;
    const y = parts[0].padStart(4, '0');
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // 时期管理函数
  const handleAddPeriod = async () => {
    if (!actor || !newPeriodName.trim()) return;
    try {
      const period = await addActorPeriod(actor.id, newPeriodName.trim());
      setPeriods(prev => [...prev, period]);
      setNewPeriodName('');
      setShowAddPeriodModal(false);
      setToast({ message: `时期"${period.name}"已创建`, type: 'success' });
    } catch (error) {
      console.error('[Actor] 添加时期失败:', error);
    }
  };

  const handleUpdatePeriod = async (periodId: number) => {
    if (!editingPeriodName.trim()) return;
    try {
      await updateActorPeriod(periodId, editingPeriodName.trim());
      setPeriods(prev => prev.map(p => p.id === periodId ? { ...p, name: editingPeriodName.trim() } : p));
      setEditingPeriodId(null);
      setToast({ message: '时期名称已更新', type: 'success' });
    } catch (error) {
      console.error('[Actor] 更新时期失败:', error);
    }
  };

  const handleDeletePeriod = async (periodId: number) => {
    if (deletingPeriodId !== periodId) {
      setDeletingPeriodId(periodId);
      return;
    }
    try {
      await deleteActorPeriod(periodId);
      setPeriods(prev => prev.filter(p => p.id !== periodId));
      setDeletingPeriodId(null);
      // 重新加载以刷新 workPeriodMap
      if (actor) {
        const periodMap = await getActorWorkPeriodMap(actor.id);
        setWorkPeriodMap(periodMap);
      }
      setToast({ message: '时期已删除，作品归入演员名时期', type: 'info' });
    } catch (error) {
      console.error('[Actor] 删除时期失败:', error);
    }
  };

  // 时期移位
  const handleMovePeriod = async (periodId: number, direction: 'up' | 'down') => {
    const sortedPeriods = [...periods].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sortedPeriods.findIndex(p => p.id === periodId);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === sortedPeriods.length - 1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const newPeriods = [...sortedPeriods];
    [newPeriods[idx], newPeriods[swapIdx]] = [newPeriods[swapIdx], newPeriods[idx]];

    try {
      await reorderActorPeriods(newPeriods.map(p => p.id));
      // 更新本地 sort_order
      const updated = newPeriods.map((p, i) => ({ ...p, sort_order: i }));
      setPeriods(updated);
      setPeriodContextMenu(null);
    } catch (error) {
      console.error('[Actor] 移位时期失败:', error);
    }
  };

  // 照片管理函数
  const handleAddPhoto = async () => {
    if (!actor) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '图片',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg', 'tif', 'tiff', 'heic', 'heif']
        }],
        title: '选择演员海报'
      });
      if (selected) {
        setUploadingPhoto(true);
        try {
          const relativePath = await saveActorPhoto(selected as string);
          await addActorPhoto(actor.id, relativePath);
          const photosData = await getActorPhotos(actor.id);
          setPhotos(photosData);
          // 切换到新添加的照片
          setCurrentPhotoIndex(photosData.length - 1);
          setToast({ message: '海报添加成功', type: 'success' });
        } catch (error) {
          console.error('[Actor] 添加海报失败:', error);
          setToast({ message: '添加海报失败', type: 'info' });
        } finally {
          setUploadingPhoto(false);
        }
      }
    } catch (error) {
      console.error('[Actor] 打开文件选择器失败:', error);
    }
  };

  const handleDeletePhoto = async (photoId: number) => {
    if (!actor) return;
    try {
      await deleteActorPhoto(photoId);
      const photosData = await getActorPhotos(actor.id);
      setPhotos(photosData);
      // 如果删的是当前显示的，切换到前一张
      if (currentPhotoIndex >= photosData.length) {
        setCurrentPhotoIndex(Math.max(0, photosData.length - 1));
      }
      setPhotoContextMenu(null);
      setToast({ message: '海报已删除', type: 'info' });
    } catch (error) {
      console.error('[Actor] 删除海报失败:', error);
    }
  };

  const handleSetPrimary = async (photoId: number) => {
    if (!actor) return;
    try {
      await setPrimaryPhoto(actor.id, photoId);
      // 重新排序（主海报在第一位）
      const photosData = await getActorPhotos(actor.id);
      setPhotos(photosData);
      setCurrentPhotoIndex(0);
      setPhotoContextMenu(null);
      setToast({ message: '主海报已更新', type: 'success' });
    } catch (error) {
      console.error('[Actor] 设置主海报失败:', error);
    }
  };

  const handleReorderPhoto = async (photoId: number, direction: 'up' | 'down') => {
    if (!actor) return;
    const nonPrimaryPhotos = photos.filter(p => p.is_primary !== 1);
    const idx = nonPrimaryPhotos.findIndex(p => p.id === photoId);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === nonPrimaryPhotos.length - 1) return;

    const newPhotos = [...nonPrimaryPhotos];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [newPhotos[idx], newPhotos[swapIdx]] = [newPhotos[swapIdx], newPhotos[idx]];

    const primaryPhoto = photos.find(p => p.is_primary === 1);
    const allIds = primaryPhoto ? [primaryPhoto.id, ...newPhotos.map(p => p.id)] : newPhotos.map(p => p.id);

    try {
      await reorderActorPhotos(actor.id, allIds);
      const photosData = await getActorPhotos(actor.id);
      setPhotos(photosData);
      // 更新当前显示索引
      const currentPhotoId = photos[currentPhotoIndex]?.id;
      const newIndex = photosData.findIndex(p => p.id === currentPhotoId);
      if (newIndex >= 0) setCurrentPhotoIndex(newIndex);
      setPhotoContextMenu(null);
    } catch (error) {
      console.error('[Actor] 重排序海报失败:', error);
    }
  };

  // 获取当前显示的照片数据 URL
  const getCurrentPhotoUrl = (): string | null => {
    if (photos.length > 0 && currentPhotoIndex < photos.length) {
      return photos[currentPhotoIndex].photo_data_url || null;
    }
    // 兼容旧数据
    return actor ? actorPhotoDataUrl(actor) : null;
  };

  const isAddButton = photos.length > 0 && currentPhotoIndex === photos.length;

  // 作品的 period_id
  const getWorkPeriodId = (resource: Video): number | null => {
    const key = resource.series_id ? `series-${resource.series_id}` : `video-${resource.id}`;
    return workPeriodMap[key] || null;
  };

  // 按时期分组作品（去重：同一 series 只显示一次）
  const workItems = Array.from(
    resources.reduce((map, resource) => {
      const key = resource.series_id ? `series-${resource.series_id}` : `video-${resource.id}`;
      if (!map.has(key)) {
        map.set(key, resource);
      }
      return map;
    }, new Map<string, Video>()).values()
  );

  // 分组：演员名时期（period_id = null）在最上，其他时期按 sort_order 排序
  const actorNamePeriodItems = workItems.filter(item => getWorkPeriodId(item) === null);
  const sortedPeriods = [...periods].sort((a, b) => a.sort_order - b.sort_order);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 flex items-center gap-2"><img src={loadingIcon} alt="加载中" className="w-6 h-6" /> 加载中...</div>
      </div>
    );
  }

  if (!actor) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">演员不存在</div>
      </div>
    );
  }

  const backState = location.state as { from?: string; backLabel?: string } | null;
  const backLabel = backState?.backLabel || '返回演员列表';
  const handleBack = () => {
    if (backState?.from) {
      navigate(-1);
    } else {
      navigate('/actors');
    }
  };

  // 渲染作品卡片
  const renderWorkCard = (resource: Video) => {
    const isSeries = Boolean(resource.series_id);
    const code = resource.series_code || '';
    const rawTitle = isSeries ? (resource.series_title || '视频集') : resource.file_name;
    const title = code ? `[${code}] ${rawTitle}` : rawTitle;
    const poster = isSeries ? (resource.series_poster_data_url || videoPosterDataUrl(resource)) : videoPosterDataUrl(resource);
    const target = isSeries ? `/series/${resource.series_id}?fromActor=${actor.id}` : `/series/${resource.series_id || resource.id}?fromActor=${actor.id}`;
    return (
      <Link
        key={isSeries ? `series-${resource.series_id}` : `video-${resource.id}`}
        to={target}
        state={{ from: `/actors/${actor.id}`, backLabel: '返回演员详情' }}
        onContextMenu={(event) => openContextMenu(event, isSeries ? 'series' : 'video', isSeries ? resource.series_id! : resource.id, title)}
        className="card block"
      >
        <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden">
          <SmartPoster src={poster} alt={title} />
        </div>
        <div className="p-5">
          <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">{title}</h3>
          {resource.series_has_chinese_sub === 1 && (
            <span className="text-xs text-orange-500">中文字幕</span>
          )}
          <div className="text-sm text-gray-500">
            
          </div>
        </div>
      </Link>
    );
  };

  return (
    <>
    <div>
      {/* 返回按钮 */}
      <div className="mb-10">
        <button type="button" onClick={handleBack} className="text-gray-500 hover:text-gray-700 flex items-center gap-2">
          <img src={backIcon} alt="返回" className="w-4 h-4" />
          <span>{backLabel}</span>
        </button>
      </div>

      {/* 演员信息 */}
      <div className="flex gap-12 mb-16">
        {/* 写真 */}
        <div className="w-80 flex-shrink-0">
          <div 
            className={`aspect-[3/4] bg-gradient-to-br from-pink-200 to-pink-300 rounded-2xl mb-4 overflow-hidden relative group ${editing ? 'cursor-pointer' : ''}`}
            onClick={editing ? handleAddPhoto : undefined}
            onContextMenu={(e) => {
              if (photos.length === 0 || currentPhotoIndex >= photos.length) return;
              if (photos[currentPhotoIndex]?.is_primary === 1) return;
              e.preventDefault();
              e.stopPropagation();
              setPhotoContextMenu({ photoId: photos[currentPhotoIndex].id, x: e.clientX, y: e.clientY });
            }}
          >
            {isAddButton ? (
              /* "+" 按钮：添加新海报 */
              <div
                className="w-full h-full flex items-center justify-center cursor-pointer hover:bg-pink-300 transition-colors"
                onClick={(e) => { e.stopPropagation(); handleAddPhoto(); }}
              >
                <div className="text-5xl text-white/80">+</div>
              </div>
            ) : getCurrentPhotoUrl() ? (
              <img
                src={getCurrentPhotoUrl()!}
                alt={actor.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <StaticImagePlaceholder kind="actor" />
            )}

            {/* 左右箭头 - 仅有多张海报时显示 */}
            {photos.length > 0 && !editing && (
              <>
                {currentPhotoIndex > 0 && (
                  <button
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); setCurrentPhotoIndex(prev => Math.max(0, prev - 1)); }}
                  >
                    ‹
                  </button>
                )}
                {(currentPhotoIndex < photos.length - 1 || (photos.length > 0 && currentPhotoIndex < photos.length)) && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); setCurrentPhotoIndex(prev => Math.min(photos.length, prev + 1)); }}
                  >
                    ›
                  </button>
                )}
              </>
            )}

            {/* 悬浮提示 - 仅编辑状态显示 */}
            {editing && (
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="bg-black/50 text-white text-xs px-3 py-1.5 rounded-full">
                  {uploadingPhoto ? '上传中...' : '点击更换海报'}
                </span>
              </div>
            )}

            {/* 主海报标记 */}
            {photos.length > 0 && currentPhotoIndex < photos.length && photos[currentPhotoIndex]?.is_primary === 1 && (
              <div className="absolute top-2 left-2 px-2 py-0.5 bg-blue-500/80 text-white text-xs rounded-full">
                主海报
              </div>
            )}
          </div>

          {/* 缩略图列表 */}
          {photos.length > 0 && !editing && (
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {photos.map((photo, idx) => (
                <div
                  key={photo.id}
                  className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                    idx === currentPhotoIndex ? 'border-blue-500 ring-1 ring-blue-300' : 'border-transparent hover:border-gray-300'
                  }`}
                  onClick={() => setCurrentPhotoIndex(idx)}
                >
                  {photo.photo_data_url ? (
                    <img src={photo.photo_data_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-pink-200 flex items-center justify-center text-xs">👤</div>
                  )}
                </div>
              ))}
              {/* "+" 缩略图按钮 */}
              <div
                className="flex-shrink-0 w-14 h-14 rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-400 flex items-center justify-center cursor-pointer text-gray-400 hover:text-blue-500 transition-colors"
                onClick={handleAddPhoto}
              >
                +
              </div>
            </div>
          )}

          {/* 兼容旧数据提示 */}
          {photos.length === 0 && actorPhotoDataUrl(actor) && !editing && (
            <div className="text-xs text-gray-400 text-center mt-1">
              点击"+"添加更多海报
              <div className="flex justify-center mt-1">
                <button
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500"
                  onClick={handleAddPhoto}
                >
                  + 添加海报
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 详细信息 */}
        <div className="flex-1">
          {editing ? (
            <div className="space-y-4">
              {/* 姓名 + 日本名 + 曾用名 */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">姓名</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">日本名</label>
                  <input
                    type="text"
                    value={editForm.japanese_name}
                    onChange={(e) => setEditForm({ ...editForm, japanese_name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">曾用名</label>
                  <input
                    type="text"
                    value={editForm.alias}
                    onChange={(e) => setEditForm({ ...editForm, alias: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* 出生日期 + 身高 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">出生日期</label>
                  <div className="flex gap-1 items-center">
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        min={1900}
                        max={2100}
                        value={numOrEmpty(bParts[0])}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
                          updateBirthday(0, v);
                        }}
                        className="w-20 px-2 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 text-center pr-6"
                      />
                      <div className="absolute right-0.5 top-0 bottom-0 flex flex-col justify-center gap-0">
                        <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const cur = parseInt(bParts[0], 10) || 0; const v = Math.min(cur + 1, 2100); updateBirthday(0, String(v)); }}>▲</button>
                        <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const cur = parseInt(bParts[0], 10) || 0; const v = Math.max(cur - 1, 1900); updateBirthday(0, String(v)); }}>▼</button>
                      </div>
                    </div>
                    <span className="text-gray-500 text-sm">年</span>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        min={1}
                        max={12}
                        value={bParts[1] || ''}
                        onChange={(e) => {
                          let v = e.target.value.replace(/[^0-9]/g, '');
                          if (v !== '' && parseInt(v, 10) > 12) v = '12';
                          updateBirthday(1, v);
                          const newMaxDay = getMaxDay(parseInt(v, 10) || 0);
                          const currentDay = parseInt(bParts[2], 10);
                          if (currentDay > newMaxDay) updateBirthday(2, String(newMaxDay));
                        }}
                        className="w-16 px-2 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 text-center pr-5"
                      />
                      <div className="absolute right-0.5 top-0 bottom-0 flex flex-col justify-center gap-0">
                        <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const cur = parseInt(bParts[1], 10) || 0; const v = cur >= 12 ? 1 : cur + 1; updateBirthday(1, String(v)); }}>▲</button>
                        <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const cur = parseInt(bParts[1], 10) || 0; const v = cur <= 1 ? 12 : cur - 1; updateBirthday(1, String(v)); }}>▼</button>
                      </div>
                    </div>
                    <span className="text-gray-500 text-sm">月</span>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        min={1}
                        max={maxDay || 31}
                        value={bParts[2] || ''}
                        onChange={(e) => {
                          let v = e.target.value.replace(/[^0-9]/g, '');
                          const md = maxDay || 31;
                          if (v !== '' && parseInt(v, 10) > md) v = String(md);
                          updateBirthday(2, v);
                        }}
                        className="w-16 px-2 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 text-center pr-5"
                      />
                      <div className="absolute right-0.5 top-0 bottom-0 flex flex-col justify-center gap-0">
                        <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const md = maxDay || 31; const cur = parseInt(bParts[2], 10) || 0; const v = cur >= md ? 1 : cur + 1; updateBirthday(2, String(v)); }}>▲</button>
                        <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const md = maxDay || 31; const cur = parseInt(bParts[2], 10) || 0; const v = cur <= 1 ? md : cur - 1; updateBirthday(2, String(v)); }}>▼</button>
                      </div>
                    </div>
                    <span className="text-gray-500 text-sm">日</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">身高</label>
                  <div className="flex items-center gap-1">
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={editForm.height}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 3);
                          setEditForm({ ...editForm, height: v });
                        }}
                        className="w-24 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 text-center pr-6"
                      />
                      <div className="absolute right-0.5 top-0 bottom-0 flex flex-col justify-center gap-0">
                        <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const cur = parseInt(editForm.height, 10) || 0; const v = Math.min(cur + 1, 200); setEditForm({ ...editForm, height: String(v) }); }}>▲</button>
                        <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const cur = parseInt(editForm.height, 10) || 0; const v = Math.max(cur - 1, 100); setEditForm({ ...editForm, height: String(v) }); }}>▼</button>
                      </div>
                    </div>
                    <span className="text-gray-500 text-sm">cm</span>
                  </div>
                </div>
              </div>

              {/* 数值 + 车灯 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">数值</label>
                  <div className="flex gap-1 items-center">
                    {[0, 1, 2].map((idx) => (
                      <React.Fragment key={idx}>
                        <span className="text-gray-500 text-sm">{['B', 'W', 'H'][idx]}</span>
                        <div className="relative">
                          <input
                            ref={(el) => { measureRefs.current[idx] = el; }}
                            type="text"
                            inputMode="numeric"
                            value={measureParts[idx]}
                            onChange={(e) => handleMeasureChange(idx, e.target.value)}
                            className="w-16 px-2 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 text-center pr-5"
                          />
                          <div className="absolute right-0.5 top-0 bottom-0 flex flex-col justify-center gap-0">
                            <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const cur = parseInt(measureParts[idx], 10) || 0; const v = Math.min(cur + 1, 150); const parts2 = (editForm.measurements || '').split('-'); while (parts2.length < 3) parts2.push(''); parts2[idx] = String(v); setEditForm({ ...editForm, measurements: parts2.join('-') }); }}>▲</button>
                            <button type="button" tabIndex={-1} className="text-gray-400 hover:text-gray-700 leading-none text-[10px]" onClick={() => { const cur = parseInt(measureParts[idx], 10) || 0; const v = Math.max(cur - 1, 0); const parts2 = (editForm.measurements || '').split('-'); while (parts2.length < 3) parts2.push(''); parts2[idx] = String(v); setEditForm({ ...editForm, measurements: parts2.join('-') }); }}>▼</button>
                          </div>
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">车灯</label>
                  <input
                    type="text"
                    value={editForm.cup_size}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
                      setEditForm({ ...editForm, cup_size: val });
                    }}
                    className="w-14 px-2 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 text-center"
                    maxLength={1}
                  />
                </div>
              </div>

              {/* 简介 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">简介</label>
                <textarea
                  value={editForm.bio}
                  onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                  rows={4}
                />
              </div>

              {/* 按钮 */}
              <div className="flex gap-4">
                <button
                  onClick={handleSave}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  保存
                </button>
                <button
                  onClick={() => {
                    if (actor) {
                      setEditForm({
                        name: actor.name,
                        bio: actor.bio || '',
                        birthday: actor.birthday || '',
                        height: actor.height || '',
                        measurements: actor.measurements || '',
                        japanese_name: actor.japanese_name || '',
                        cup_size: actor.cup_size || '',
                        alias: actor.alias || '',
                      });
                    }
                    setEditing(false);
                    clearEditQuery();
                  }}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-4xl font-bold text-gray-900 mb-4">{actor.name}</h1>
              {actor.japanese_name && (
                <p className="text-lg text-gray-500 mb-4">{actor.japanese_name}</p>
              )}
              {actor.alias && (
                <p className="text-sm text-gray-400 mb-4">曾用名: {actor.alias}</p>
              )}
              
              <div className="grid grid-cols-2 gap-6 mb-8 text-sm">
                {actor.birthday && (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-20">出生日期</span>
                    <span className="font-medium">{actor.birthday}</span>
                  </div>
                )}
                {actor.height && (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-20">身高</span>
                    <span className="font-medium">{actor.height}cm</span>
                  </div>
                )}
                {actor.measurements && (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-20">数值</span>
                    <span className="font-medium">
                      {actor.measurements.split('-').filter(Boolean).join('-')}
                    </span>
                  </div>
                )}
                {actor.cup_size && (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-20">车灯</span>
                    <span className="font-medium">{actor.cup_size}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 w-20">作品数量</span>
                  <span className="font-medium">{actor.work_count || workItems.length}部</span>
                </div>
              </div>

              {actor.bio && (
                <p className="text-gray-600 mb-8 leading-relaxed text-lg">{actor.bio}</p>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setEditing(true)}
                  className="px-6 py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800"
                >
                  ✏️ 编辑信息
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 参演作品 */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">参演作品</h2>
          <div className="flex gap-3">
            <button
              onClick={() => { setShowAddPeriodModal(true); setNewPeriodName(''); }}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            >
              + 添加时期
            </button>
            <button
              onClick={handleAddWork}
              disabled={addingWork}
              className="px-6 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {addingWork ? '添加中...' : '添加作品'}
            </button>
          </div>
        </div>



        {/* 分组展示 */}
        {workItems.length > 0 ? (
          <div>
            {/* 演员名时期（虚拟，固定最上） */}
            {actorNamePeriodItems.length > 0 && (
              <div className="mb-8">
                <h3 className="text-lg font-bold text-gray-900 mb-4">{actor.name}</h3>
                <div className="grid grid-cols-4 gap-6">
                  {actorNamePeriodItems.map(resource => renderWorkCard(resource))}
                </div>
              </div>
            )}

            {/* 其他时期，按 sort_order 排序 */}
            {sortedPeriods.map(period => {
              const periodItems = workItems.filter(item => getWorkPeriodId(item) === period.id);
              return (
                <div key={period.id} className="mb-8">
                  {editingPeriodId === period.id ? (
                    <div className="flex items-center gap-2 mb-4">
                      <input
                        type="text"
                        value={editingPeriodName}
                        onChange={e => setEditingPeriodName(e.target.value)}
                        onBlur={() => handleUpdatePeriod(period.id)}
                        onKeyDown={e => { if (e.key === 'Enter') handleUpdatePeriod(period.id); if (e.key === 'Escape') setEditingPeriodId(null); }}
                        autoFocus
                        className="px-2 py-1 border border-blue-300 rounded text-lg font-bold focus:outline-none"
                      />
                    </div>
                  ) : (
                    <h3
                      className="text-sm font-bold text-gray-900 mb-4 cursor-default select-none"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPeriodContextMenu({ periodId: period.id, x: e.clientX, y: e.clientY });
                      }}
                    >
                      {period.name}
                    </h3>
                  )}
                  {periodItems.length > 0 ? (
                    <div className="grid grid-cols-4 gap-6">
                      {periodItems.map(resource => renderWorkCard(resource))}
                    </div>
                  ) : (
                    <p className="text-gray-400 text-sm">该时期暂无作品</p>
                  )}
                </div>
              );
            })}

            {/* 没有时期但有未分类作品时，如果没有时期则不显示演员名标题（因为全部都在演员名时期） */}
            {periods.length === 0 && actorNamePeriodItems.length > 0 && (
              // 已经在上面显示了，不需要额外处理
              null
            )}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-gray-500">暂无参演作品</p>
            <p className="text-gray-400 text-sm mt-2">点击"添加作品"按钮添加</p>
          </div>
        )}
      </section>

      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-2 w-fit"
          style={{ left: contextMenu.x + 160 > window.innerWidth ? contextMenu.x - 160 : contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={handleEditContextItem}
          >
            编辑
          </button>
          {contextMenu.type === 'series' && (
            <button
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => handleRescanMetadata(contextMenu.id)}
            >
              重新扫描元数据
            </button>
          )}
          <button
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              const key = `${contextMenu.type}-${contextMenu.id}`;
              requestSecondConfirm(key, () => contextMenu.type === 'video'
                ? handleDeleteVideo(contextMenu.id)
                : handleDeleteSeries(contextMenu.id));
            }}
          >
            {pendingKey === `${contextMenu.type}-${contextMenu.id}` ? '再次点击确认删除' : '删除'}
          </button>
        </div>
      )}

      {/* 时期右键菜单 */}
      {periodContextMenu && (() => {
        const sortedP = [...periods].sort((a, b) => a.sort_order - b.sort_order);
        const idx = sortedP.findIndex(p => p.id === periodContextMenu.periodId);
        const canMoveUp = idx > 0;
        const canMoveDown = idx >= 0 && idx < sortedP.length - 1;
        return (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-2 w-fit"
            style={{ left: periodContextMenu.x + 160 > window.innerWidth ? periodContextMenu.x - 160 : periodContextMenu.x, top: periodContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => {
                const p = periods.find(pp => pp.id === periodContextMenu.periodId);
                if (p) {
                  setEditingPeriodId(p.id);
                  setEditingPeriodName(p.name);
                }
                setPeriodContextMenu(null);
              }}
            >
              编辑
            </button>
            <button
              className={`w-full text-left px-4 py-2 text-sm ${canMoveUp ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 cursor-not-allowed'}`}
              onClick={() => canMoveUp && handleMovePeriod(periodContextMenu.periodId, 'up')}
            >
              ↑ 移位上
            </button>
            <button
              className={`w-full text-left px-4 py-2 text-sm ${canMoveDown ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 cursor-not-allowed'}`}
              onClick={() => canMoveDown && handleMovePeriod(periodContextMenu.periodId, 'down')}
            >
              ↓ 移位下
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                if (deletingPeriodId === periodContextMenu.periodId) {
                  // 已经确认过了，直接删除
                  handleDeletePeriod(periodContextMenu.periodId);
                } else {
                  setDeletingPeriodId(periodContextMenu.periodId);
                  // 3秒后重置
                  setTimeout(() => setDeletingPeriodId(null), 3000);
                }
              }}
            >
              {deletingPeriodId === periodContextMenu.periodId ? '再次点击确认删除' : '删除'}
            </button>
          </div>
        );
      })()}

      {/* 照片右键菜单 */}
      {photoContextMenu && (() => {
        const nonPrimaryPhotos = photos.filter(p => p.is_primary !== 1);
        const idx = nonPrimaryPhotos.findIndex(p => p.id === photoContextMenu.photoId);
        const canMoveUp = idx > 0;
        const canMoveDown = idx >= 0 && idx < nonPrimaryPhotos.length - 1;
        return (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-2 w-fit"
            style={{ left: photoContextMenu.x + 160 > window.innerWidth ? photoContextMenu.x - 160 : photoContextMenu.x, top: photoContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className={`w-full text-left px-4 py-2 text-sm ${canMoveUp ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 cursor-not-allowed'}`}
              onClick={() => canMoveUp && handleReorderPhoto(photoContextMenu.photoId, 'up')}
            >
              ↑ 移位上
            </button>
            <button
              className={`w-full text-left px-4 py-2 text-sm ${canMoveDown ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 cursor-not-allowed'}`}
              onClick={() => canMoveDown && handleReorderPhoto(photoContextMenu.photoId, 'down')}
            >
              ↓ 移位下
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => {
                const key = `set-primary-${photoContextMenu.photoId}`;
                requestSecondConfirm(key, () => handleSetPrimary(photoContextMenu.photoId));
              }}
            >
              {pendingKey === `set-primary-${photoContextMenu.photoId}` ? '再次点击确认设为主海报' : '⭐ 设为主海报'}
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                const key = `delete-photo-${photoContextMenu.photoId}`;
                requestSecondConfirm(key, () => handleDeletePhoto(photoContextMenu.photoId));
              }}
            >
              {pendingKey === `delete-photo-${photoContextMenu.photoId}` ? '再次点击确认删除' : '🗑 删除'}
            </button>
          </div>
        );
      })()}
    </div>

    {/* 选择时期弹窗 */}
    {periodSelectVisible && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPeriodSelectVisible(false)}>
        <div className="bg-white rounded-2xl shadow-2xl p-6 min-w-80" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-gray-900 mb-4">选择时期</h3>
          <div className="space-y-2 mb-6">
            {/* 演员名时期（period_id = null） */}
            <button
              className="w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors text-sm"
              onClick={() => { setPeriodSelectVisible(false); doAddWork(undefined); }}
            >
              {actor?.name}（演员名时期）
            </button>
            {/* 其他时期 */}
            {[...periods].sort((a, b) => a.sort_order - b.sort_order).map(period => (
              <button
                key={period.id}
                className="w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors text-sm"
                onClick={() => { setPeriodSelectVisible(false); doAddWork(period.id); }}
              >
                {period.name}
              </button>
            ))}
          </div>
          <button
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            onClick={() => setPeriodSelectVisible(false)}
          >
            取消
          </button>
        </div>
      </div>
    )}

    {/* 新增时期弹窗 */}
    {showAddPeriodModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
          <h3 className="text-lg font-bold text-gray-900 mb-4">新增时期</h3>
          <input
            type="text"
            value={newPeriodName}
            onChange={(e) => setNewPeriodName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddPeriod(); if (e.key === 'Escape') { setNewPeriodName(''); setShowAddPeriodModal(false); } }}
            placeholder="输入时期名称"
            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 mb-4"
            autoFocus
          />
          <div className="flex gap-3">
            <button
              onClick={handleAddPeriod}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
            >
              确认
            </button>
            <button
              onClick={() => { setNewPeriodName(''); setShowAddPeriodModal(false); }}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Toast 提示 */}
    {toast && (
      <div className="fixed top-20 right-6 z-50" style={{ animation: 'slideInRight 0.3s ease-out' }}>
        <div className="px-5 py-4 rounded-xl shadow-xl text-base text-gray-900 bg-white border border-gray-300">
          {toast.message}
        </div>
      </div>
    )}
    </>
  );
};

export default ActorDetail;
