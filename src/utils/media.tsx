import React from 'react';

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

export type ImageOrientation = 'landscape' | 'portrait' | 'square' | 'unknown';

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
      <div className={isVideo ? 'text-4xl' : 'text-5xl'}>{isVideo ? '▶️' : '👤'}</div>
    </div>
  );
};

/**
 * 判断海报方向：优先使用后端返回的 poster_orientation 字段，
 * 其次根据 width/height 判断，最后回退到 unknown。
 */
function resolveOrientation(
  posterOrientation?: string | null,
  width?: number | null,
  height?: number | null,
): ImageOrientation {
  // 优先使用后端明确返回的方向
  if (posterOrientation === 'portrait') return 'portrait';
  if (posterOrientation === 'landscape') return 'landscape';
  if (posterOrientation === 'square') return 'square';

  // 根据宽高比判断
  if (width && height) {
    if (height > width * 1.15) return 'portrait';
    if (width > height * 1.15) return 'landscape';
    return 'square';
  }

  return 'unknown';
}

interface SmartPosterProps {
  src?: string | null;
  alt: string;
  kind?: 'video' | 'actor';
  className?: string;
  imageClassName?: string;
  /** 后端返回的海报方向（如 VideoSeries.poster_orientation） */
  posterOrientation?: string | null;
  /** 视频/图片宽度（如 Video.width） */
  width?: number | null;
  /** 视频/图片高度（如 Video.height） */
  height?: number | null;
}

export const SmartPoster: React.FC<SmartPosterProps> = ({
  src,
  alt,
  kind = 'video',
  className = '',
  imageClassName = '',
  posterOrientation,
  width,
  height,
}) => {
  const orientation = resolveOrientation(posterOrientation, width, height);
  const isPortrait = orientation === 'portrait';

  if (!src) {
    return <StaticImagePlaceholder kind={kind} className={className} />;
  }

  return (
    <div className={`relative w-full h-full overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 ${className}`}>
      <img
        src={src}
        alt={alt}
        className={
          isPortrait
            ? `w-full h-full object-contain ${imageClassName}`
            : `relative z-10 w-full h-full object-cover ${imageClassName}`
        }
      />
    </div>
  );
};
