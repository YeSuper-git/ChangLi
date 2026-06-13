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
