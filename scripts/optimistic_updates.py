"""中优先级乐观更新改造脚本"""
import re

def apply_optimistic_updates():
    # === Settings.tsx ===
    with open('src/pages/Settings.tsx', 'r') as f:
        s = f.read()
    
    # 1. 游戏覆盖开关：移除 loading，乐观更新
    s = s.replace(
        """              setGameOverlayLoading(true);
              try {
                await setGameOverlayDisabled(checked);
                setGameOverlayState(checked);
                notify({ message: checked ? '已禁用游戏覆盖' : '已启用游戏覆盖', type: 'success' });
              } catch (error) {
                notify({ message: '操作失败，请稍后重试', type: 'error' });
              } finally {
                setGameOverlayLoading(false);
              }""",
        """              setGameOverlayState(checked);
              try {
                await setGameOverlayDisabled(checked);
                notify({ message: checked ? '已禁用游戏覆盖' : '已启用游戏覆盖', type: 'success' });
              } catch (error) {
                setGameOverlayState(!checked);
                notify({ message: '操作失败，请稍后重试', type: 'error' });
              }"""
    )
    s = s.replace(
        '  const [gameOverlayLoading, setGameOverlayLoading] = useState(false);',
        '  // gameOverlayLoading 已移除，改为乐观更新'
    )
    
    # 2. 标签添加：乐观更新
    s = s.replace(
        """      await addTag(name);
      setNewTagName('');
      loadTags();
      clearLibraryFilterCaches();""",
        """      const tempTag = { id: -Date.now(), name, created_at: new Date().toISOString() };
      setTags((prev: any) => [...prev, tempTag].sort((a: any, b: any) => a.name.localeCompare(b.name)));
      setNewTagName('');
      clearLibraryFilterCaches();
      try { await addTag(name); } catch {}"""
    )
    
    # 3. 标签删除：乐观更新
    s = s.replace(
        """      await deleteTag(id);
      loadTags();
      clearLibraryFilterCaches();""",
        """      setTags((prev: any) => prev.filter((t: any) => t.id !== id));
      clearLibraryFilterCaches();
      try { await deleteTag(id); } catch {}"""
    )
    
    # 4. 标签编辑：乐观更新
    s = s.replace(
        """      await updateTag(editingTagId, editingTagName.trim());
      setEditingTagId(null);
      setEditingTagName('');
      loadTags();
      clearLibraryFilterCaches();""",
        """      setTags((prev: any) => prev.map((t: any) => t.id === editingTagId ? { ...t, name: editingTagName.trim() } : t));
      setEditingTagId(null);
      setEditingTagName('');
      clearLibraryFilterCaches();
      try { await updateTag(editingTagId, editingTagName.trim()); } catch {}"""
    )
    
    with open('src/pages/Settings.tsx', 'w') as f:
        f.write(s)
    print("Settings.tsx done")
    
    # === Actors.tsx ===
    with open('src/pages/Actors.tsx', 'r') as f:
        s = f.read()
    
    s = s.replace(
        """      await deleteActor(actorId);
      await refreshActors();""",
        """      setActors((prev: any) => prev.filter((a: any) => a.id !== actorId));
      try { await deleteActor(actorId); } catch {}"""
    )
    
    with open('src/pages/Actors.tsx', 'w') as f:
        f.write(s)
    print("Actors.tsx done")
    
    # === SeriesDetail.tsx ===
    with open('src/pages/SeriesDetail.tsx', 'r') as f:
        s = f.read()
    
    # 保存排序：乐观更新
    s = s.replace(
        """    try {
      await updateVideoEpisodeNumbers(updates);
      setSelectMode(false);
      await loadSeries();
      await refreshSeries();
    } catch (error) {
      console.error('保存排序失败:', error);
      notify({ message: '保存排序失败', type: 'error' });
    }""",
        """    setVideos(selectModeVideos);
    setSelectMode(false);
    try {
      await updateVideoEpisodeNumbers(updates);
      await loadSeries();
    } catch (error) {
      notify({ message: '保存排序失败', type: 'error' });
    }"""
    )
    
    with open('src/pages/SeriesDetail.tsx', 'w') as f:
        f.write(s)
    print("SeriesDetail.tsx done")
    
    # === ActorDetail.tsx ===
    with open('src/pages/ActorDetail.tsx', 'r') as f:
        s = f.read()
    
    # 删除视频：乐观更新
    s = s.replace(
        """      await deleteVideo(id);
      await loadActor(actor.id);""",
        """      setResources((prev: any) => prev.filter((r: any) => r.video_id !== id));
      try { await deleteVideo(id); } catch {}"""
    )
    
    # 删除视频集：乐观更新
    s = s.replace(
        """      await deleteVideoSeries(id, true);
      await loadActor(actor.id);""",
        """      setResources((prev: any) => prev.filter((r: any) => r.series_id !== id));
      try { await deleteVideoSeries(id, true); } catch {}"""
    )
    
    # 保存演员：乐观更新（先更新UI再后台保存）
    # 找到 handleSave 中的 updateActor 调用
    s = s.replace(
        """      await updateActor(
        actor.id,
        editForm.name,
        actor.photo,
        editForm.bio || undefined,
        normalizeBirthday(editForm.birthday),
        editForm.height || undefined,
        editForm.measurements || undefined,
        editForm.japanese_name || undefined,
        editForm.cup_size || undefined,
        editForm.alias || undefined,
        (editForm as any).weight || undefined
      );
      setEditing(false);""",
        """      setActor((prev: any) => prev ? { ...prev, ...editForm } : prev);
      setEditing(false);
      await updateActor(
        actor.id,
        editForm.name,
        actor.photo,
        editForm.bio || undefined,
        normalizeBirthday(editForm.birthday),
        editForm.height || undefined,
        editForm.measurements || undefined,
        editForm.japanese_name || undefined,
        editForm.cup_size || undefined,
        editForm.alias || undefined,
        (editForm as any).weight || undefined
      );"""
    )
    
    # 添加时期：乐观更新
    s = s.replace(
        """      const period = await addActorPeriod(actor.id, newPeriodName);
      setPeriods(prev => [...prev, period]);""",
        """      const tempPeriod: any = { id: -Date.now(), actor_id: actor.id, period_name: newPeriodName, created_at: new Date().toISOString(), name: newPeriodName, sort_order: periods.length };
      setPeriods((prev: any) => [...prev, tempPeriod]);
      setNewPeriodName('');
      try {
        const period = await addActorPeriod(actor.id, newPeriodName);
        setPeriods((prev: any) => prev.map((p: any) => p.id === tempPeriod.id ? period : p));
      } catch {}"""
    )
    
    # 更新时期：乐观更新
    s = s.replace(
        """      await updateActorPeriod(periodId, editingPeriodName);
      setPeriods(prev => prev.map(p => p.id === periodId ? { ...p, period_name: editingPeriodName } : p));
      setEditingPeriodId(null);""",
        """      setPeriods((prev: any) => prev.map((p: any) => p.id === periodId ? { ...p, period_name: editingPeriodName } : p));
      setEditingPeriodId(null);
      try { await updateActorPeriod(periodId, editingPeriodName); } catch {}"""
    )
    
    # 删除时期：乐观更新
    s = s.replace(
        """      await deleteActorPeriod(periodId);
      setPeriods(prev => prev.filter(p => p.id !== periodId));""",
        """      setPeriods((prev: any) => prev.filter((p: any) => p.id !== periodId));
      try { await deleteActorPeriod(periodId); } catch {}"""
    )
    
    # 删除海报：乐观更新
    s = s.replace(
        """      await deleteActorPhoto(photoId);
      const [updatedActor, updatedPhotos] = await Promise.all([
        getActor(actor.id),
        getActorPhotos(actor.id)
      ]);
      setActor(updatedActor);
      setPhotos(updatedPhotos);""",
        """      setPhotos((prev: any) => prev.filter((p: any) => p.id !== photoId));
      try { await deleteActorPhoto(photoId); } catch {}"""
    )
    
    # 设为主海报：乐观更新
    s = s.replace(
        """      await setPrimaryPhoto(actor.id, photoId);
      const [updatedActor, updatedPhotos] = await Promise.all([
        getActor(actor.id),
        getActorPhotos(actor.id)
      ]);
      setActor(updatedActor);
      setPhotos(updatedPhotos);""",
        """      setPhotos((prev: any) => prev.map((p: any) => ({ ...p, is_primary: p.id === photoId ? 1 : 0 })));
      try { await setPrimaryPhoto(actor.id, photoId); } catch {}"""
    )
    
    with open('src/pages/ActorDetail.tsx', 'w') as f:
        f.write(s)
    print("ActorDetail.tsx done")

apply_optimistic_updates()
