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
      console.error('[CompletionGallery] 加载影评失败:', error);
      notify({ message: '影评加载失败，请稍后重试', type: 'error' });
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
    const rated = records.filter(item => item.rating !== null && item.rating !== undefined).length;
    const avg = rated ? records.reduce((sum, item) => sum + (item.rating || 0), 0) / rated : 0;
    return { total: records.length, rated, avg };
  }, [records]);

  const ratingValue = () => {
    const value = Number(rating);
    if (!Number.isFinite(value)) return 0;
    return Math.round(Math.min(5, Math.max(0, value)) * 10) / 10;
  };

  const ratingTier = (value: number) => {
    if (value >= 4.5) return '神作';
    if (value >= 3) return '不错';
    if (value >= 2) return '还行';
    return '一般';
  };

  const openRecord = (record: SeriesCompletionRecord, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setCloseTarget({
      x: rect.left + rect.width / 2 - window.innerWidth / 2,
      y: rect.top + rect.height / 2 - window.innerHeight / 2,
    });
    setClosing(false);
    setActive(record);
    setRating(record.rating !== null && record.rating !== undefined ? record.rating.toFixed(1) : '0');
    setReview(record.review || '');
    setCompletedAt(toInputDate(record.completed_at || record.last_played));
  };

  const closeDetail = () => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setActive(null);
      setClosing(false);
    }, 460);
  };

  const normalizedRating = () => {
    const value = Number(rating);
    if (!Number.isFinite(value)) return undefined;
    return Math.round(Math.min(5, Math.max(0, value)) * 10) / 10;
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
      notify({ message: '影评已保存', type: 'success' });
    } catch (error) {
      console.error('[CompletionGallery] 保存影评失败:', error);
      notify({ message: '保存失败，请稍后重试', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="completion-gallery-page" data-tutorial="completion-page">
      <section className="completion-gallery-hero">
        <div>
          <p className="completion-gallery-kicker">看完记录</p>
          <h1>故事落幕，留下你的不同见解</h1>
          <p>记录每部作品看完后的评分、时间和短评。</p>
        </div>
        <div className="completion-gallery-stats" aria-label="影评统计">
          <div><strong>{stats.total}</strong><span>已看完</span></div>
          <div><strong>{stats.rated}</strong><span>已评价</span></div>
          <div><strong>{stats.avg ? stats.avg.toFixed(1) : '-'}</strong><span>平均分</span></div>
        </div>
      </section>

      {loading ? (
        <div className="completion-gallery-loading">
          <img src={loadingIcon} alt="" />
          <span>正在整理影评</span>
        </div>
      ) : records.length === 0 ? (
        <div className="completion-gallery-empty">
          <h3>还没有影评</h3>
          <p>在视频库里把视频集标记为已看完后，可以在这里补充评分和短评。</p>
          <Link to="/library" className="completion-gallery-link">去视频库看看</Link>
        </div>
      ) : (
        <div className="completion-shelf" aria-label="影评列表">
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
                <div className="completion-award-poster">
                  <SmartPoster src={poster} alt={record.title} posterOrientation={record.poster_orientation} />
                </div>
                <div className="completion-award-body">
                  <span className="completion-award-date">{formatDate(record.completed_at || record.last_played)}</span>
                  <h3>{record.title}</h3>
                  <div className="completion-award-score">
                    <strong>{record.rating !== null && record.rating !== undefined ? record.rating.toFixed(1) : '待评'}</strong>
                    {(record.rating === null || record.rating === undefined) && <span>补评价</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <FloatingActions onRefresh={loadRecords} refreshLabel="刷新影评" />

      {active && (
        <div className={`completion-detail-backdrop ${closing ? 'is-closing' : ''}`} onClick={closeDetail}>
          <section
            className="completion-review-panel"
            style={{ '--close-x': `${closeTarget.x}px`, '--close-y': `${closeTarget.y}px` } as React.CSSProperties}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="completion-detail-close" type="button" aria-label="关闭" onClick={closeDetail}><span aria-hidden="true">×</span></button>
            <div className="completion-review-head">
              <h2>{active.title}</h2>
            </div>
            <div className="completion-review-grid">
              <div className="completion-review-poster">
                <SmartPoster src={seriesPosterSrc(active)} alt={active.title} posterOrientation={active.poster_orientation} />
              </div>
              <div className="completion-review-form">
                <div className="completion-meta-row">
                  <label className="completion-rating-field">
                    <span>我的评分</span>
                    <div className="completion-rating-row">
                      <span className="completion-rating-value">{ratingValue().toFixed(1)}</span>
                      <div
                        className="completion-rating-slider"
                        style={{ '--rating-progress': `${(ratingValue() / 5) * 100}%` } as React.CSSProperties}
                      >
                        <input
                          type="range"
                          min="0"
                          max="5"
                          step="0.1"
                          value={ratingValue()}
                          aria-label="我的评分"
                          onChange={(event) => setRating(Number(event.target.value).toFixed(1))}
                        />
                        <div className="completion-rating-scale" aria-hidden="true">
                          <span>一般</span>
                          <span>还行</span>
                          <span>不错</span>
                          <span>神作</span>
                        </div>
                      </div>
                      <span className="completion-rating-tier">{ratingTier(ratingValue())}</span>
                    </div>
                  </label>
                  <label className="completion-date-field">
                    <span>看完时间</span>
                    <input className="completion-date-input" type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} />
                  </label>
                </div>
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
