import React, { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import brandIcon from '../assets/brand/app-icon.png';

export function imageDataUrl(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith('data:image/')) return raw;
  // 兼容历史数据：旧缓存里可能只存纯 base64，没有 data:image 前缀。
  // 只对看起来像 base64 的长字符串补前缀，避免把普通文件路径误判成图片数据。
  if (raw.length > 100 && /^[A-Za-z0-9+/=\r\n]+$/.test(raw)) {
    return `data:image/jpeg;base64,${raw.replace(/\s+/g, '')}`;
  }
  return null;
}

export function videoPosterDataUrl(video: { thumbnail_data_url?: string | null }): string | null {
  return imageDataUrl(video.thumbnail_data_url);
}

export function seriesPosterSrc(series: { poster_data_url?: string | null; poster_base64?: string | null; poster?: string | null }): string | null {
  const dataUrl = imageDataUrl(series.poster_data_url) || imageDataUrl(series.poster_base64);
  if (dataUrl) return dataUrl;
  if (series.poster) return convertFileSrc(series.poster);
  return null;
}

export function actorPhotoDataUrl(actor: { photo_data_url?: string | null }): string | null {
  return imageDataUrl(actor.photo_data_url);
}

interface PlaceholderProps {
  kind: 'video' | 'actor';
  className?: string;
}

export const StaticImagePlaceholder: React.FC<PlaceholderProps> = ({ kind, className = '' }) => {
  const isVideo = kind === 'video';
  return (
    <div
      className={`w-full h-full flex items-center justify-center ${className}`}
      aria-label={isVideo ? '视频封面占位图' : '演员头像占位图'}
    >
      {isVideo ? <img src={brandIcon} alt="ChangLi" className="w-12 h-12 rounded-xl object-contain opacity-40" /> : <div className="text-5xl">👤</div>}
    </div>
  );
};

interface SmartPosterProps {
  src?: string | null;
  alt: string;
  kind?: 'video' | 'actor';
  className?: string;
  imageClassName?: string;
  /** 后端返回的海报方向（保留接口兼容，内部不再使用） */
  posterOrientation?: string | null;
  /** 视频/图片宽度（保留接口兼容，内部不再使用） */
  width?: number | null;
  /** 视频/图片高度（保留接口兼容，内部不再使用） */
  height?: number | null;
}

export const SmartPoster: React.FC<SmartPosterProps> = ({
  src,
  alt,
  kind = 'video',
  className = '',
  imageClassName = '',
}) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    setFailedSrc(null);
  }, [src]);

  if (!src || failedSrc === src) {
    return <StaticImagePlaceholder kind={kind} className={className} />;
  }

  return (
    <div className={`relative w-full h-full overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 ${className}`}>
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${imageClassName}`}
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
};
