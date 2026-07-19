import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCompletionRecords, saveCompletionRecord } from '../utils/api';
import type { SeriesCompletionRecord } from '../utils/api';
import { seriesPosterSrc, SmartPoster } from '../utils/media';
import { notify } from '../utils/notify';
import loadingIcon from '../assets/icons/loading.svg';
import FloatingActions from '../components/FloatingActions';

const formatDate = (value?: string | null) => {
  if (!value) return '待记录';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const todayInputValue = () => {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const toInputDate = (value?: string | null) => {
  if (!value) return todayInputValue();
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || todayInputValue();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const CompletionGallery: React.FC = () => {
  const [records, setRecords] = useState<SeriesCompletionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<SeriesCompletionRecord | null>(null);
  const [rating, setRating] = useState('');
  const [review, setReview] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeTarget, setCloseTarget] = useState({ x: 0, y: 0 });
  const closeTimerRef = useRef<number | null>(null);
  const [completedAt, setCompletedAt] = useState(todayInputValue());
  const [saving, setSaving] = useState(false);

  const loadRecords = async () => {
    try {
      const list = await getCompletionRecords();
      setRecords(list);
      if (active) {
        const updated = list.find(item => item.series_id === active.series_id);
        if (updated) setActive(updated);
      }
    } catch (error) {
      console.error('[CompletionGallery] 加载金番奖失败:', error);
      notify({ message: '金番奖加载失败，请稍后重试', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const rated = records.filter(item => item.rating).length;
    const avg = rated ? records.reduce((sum, item) => sum + (item.rating || 0), 0) / rated : 0;
    return { total: records.length, rated, avg };
  }, [records]);

  const openRecord = (record: SeriesCompletionRecord, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCloseTarget({
      x: rect.left + rect.width / 2 - window.innerWidth / 2,
      y: rect.top + rect.height / 2 - window.innerHeight / 2,
    });
    setClosing(false);
    setActive(record);
    setRating(record.rating ? record.rating.toFixed(1) : '');
    setReview(record.review || '');
    setCompletedAt(toInputDate(record.completed_at || record.last_played));
  };

  const closeDetail = () => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setActive(null);
      setClosing(false);
    }, 360);
  };

  const normalizedRating = () => {
    const value = Number(rating);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return Math.round(Math.min(5, Math.max(0.1, value)) * 10) / 10;
  };

  const handleSave = async () => {
    if (!active) return;
    setSaving(true);
    try {
      const saved = await saveCompletionRecord({
        series_id: active.series_id,
        rating: normalizedRating(),
        review,
        completed_at: completedAt,
      });
      setRecords(prev => prev.map(item => item.series_id === saved.series_id ? saved : item));
      setActive(saved);
      notify({ message: '金番奖记录已保存', type: 'success' });
    } catch (error) {
      console.error('[CompletionGallery] 保存金番奖记录失败:', error);
      notify({ message: '保存失败，请稍后重试', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="completion-gallery-page">
      <section className="completion-gallery-hero">
        <div>
          <p className="completion-gallery-kicker">已看完的视频集评选</p>
          <h1>金番奖</h1>
          <p>把每一部看完的番纳入金番奖，补上评分、短评和看完日期，像收藏奖项一样留下记录。</p>
        </div>
        <div className="completion-gallery-stats" aria-label="金番奖统计">
          <div><strong>{stats.total}</strong><span>已入馆</span></div>
          <div><strong>{stats.rated}</strong><span>已评价</span></div>
          <div><strong>{stats.avg ? stats.avg.toFixed(1) : '-'}</strong><span>平均分</span></div>
        </div>
      </section>

      {loading ? (
        <div className="completion-gallery-loading">
          <img src={loadingIcon} alt="" />
          <span>正在整理金番奖</span>
        </div>
      ) : records.length === 0 ? (
        <div className="completion-gallery-empty">
          <h3>金番奖还是空的</h3>
          <p>在视频库里把视频集标记为已看完后，它会自动进入金番奖。</p>
          <Link to="/library" className="completion-gallery-link">去视频库看看</Link>
        </div>
      ) : (
        <div className="completion-shelf" aria-label="金番奖证书陈列">
          {records.map((record, index) => {
            const poster = seriesPosterSrc(record);
            return (
              <button
                key={record.series_id}
                type="button"
                className="completion-award-card"
                style={{ '--award-index': index } as React.CSSProperties}
                onClick={(event) => openRecord(record, event)}
              >
                <span className="completion-award-ribbon">金番奖证书</span>
                <div className="completion-award-poster">
                  <SmartPoster src={poster} alt={record.title} posterOrientation={record.poster_orientation} />
                </div>
                <div className="completion-award-body">
                  <span className="completion-award-date">{formatDate(record.completed_at || record.last_played)}</span>
                  <h3>{record.title}</h3>
                  <div className="completion-award-score">
                    <strong>{record.rating ? record.rating.toFixed(1) : '待评'}</strong>
                    {!record.rating && <span>补评价</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <FloatingActions onRefresh={loadRecords} refreshLabel="刷新金番奖" />

      {active && (
        <div className={`completion-detail-backdrop ${closing ? 'is-closing' : ''}`} onClick={closeDetail}>
          <section
            className="completion-certificate-back"
            style={{ '--close-x': `${closeTarget.x}px`, '--close-y': `${closeTarget.y}px` } as React.CSSProperties}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="completion-detail-close" type="button" aria-label="关闭" onClick={closeDetail}>×</button>
            <div className="completion-certificate-head">
              <h2>{active.title}</h2>
              <p>{active.video_count > 0 ? `全 ${active.video_count} 话` : '暂无资源'}</p>
            </div>
            <div className="completion-certificate-grid">
              <div className="completion-certificate-poster">
                <SmartPoster src={seriesPosterSrc(active)} alt={active.title} posterOrientation={active.poster_orientation} />
              </div>
              <div className="completion-certificate-form">
                <label>
                  <span>我的评分</span>
                  <div className="completion-rating-row">
                    <input
                      type="number"
                      min="0.1"
                      max="5"
                      step="0.1"
                      value={rating}
                      onChange={(event) => setRating(event.target.value)}
                      onBlur={() => {
                        const value = normalizedRating();
                        setRating(value ? value.toFixed(1) : '');
                      }}
                      placeholder="例如 4.6"
                    />
                    <span>满分 5 分，支持一位小数</span>
                  </div>
                </label>
                <label>
                  <span>看完时间</span>
                  <input type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} />
                </label>
                <label>
                  <span>我的短评</span>
                  <textarea
                    value={review}
                    onChange={(event) => setReview(event.target.value)}
                    placeholder="最想说的话"
                    rows={6}
                  />
                </label>
                <div className="completion-detail-actions">
                  <Link to={`/series/${active.series_id}`} className="completion-secondary-action">查看视频</Link>
                  <button type="button" className="completion-primary-action" disabled={saving} onClick={handleSave}>
                    {saving ? '保存中' : '保存记录'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default CompletionGallery;
