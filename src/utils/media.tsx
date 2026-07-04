import React from 'react';
import brandIcon from '../assets/brand/app-icon.png';

export function imageDataUrl(value?: string | null): string | null {
  if (!value) return null;
  return value.startsWith('data:image/') ? value : null;
}

export function videoPosterDataUrl(video: { thumbnail_data_url?: string | null }): string | null {
  return imageDataUrl(video.thumbnail_data_url);
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
      {isVideo ? <img src={brandIcon} alt="ChangLi" className="w-12 h-12 object-contain opacity-40" /> : <div className="text-5xl">👤</div>}
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
  if (!src) {
    return <StaticImagePlaceholder kind={kind} className={className} />;
  }

  return (
    <div className={`relative w-full h-full overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 ${className}`}>
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${imageClassName}`}
      />
    </div>
  );
};
