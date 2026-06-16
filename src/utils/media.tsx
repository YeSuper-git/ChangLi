import React, { useEffect, useState } from 'react';

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

interface SmartPosterProps {
  src?: string | null;
  alt: string;
  kind?: 'video' | 'actor';
  className?: string;
  imageClassName?: string;
  onOrientationChange?: (orientation: ImageOrientation) => void;
}

const getOrientation = (width: number, height: number): ImageOrientation => {
  if (!width || !height) return 'unknown';
  if (height > width * 1.15) return 'portrait';
  if (width > height * 1.15) return 'landscape';
  return 'square';
};

export const SmartPoster: React.FC<SmartPosterProps> = ({
  src,
  alt,
  kind = 'video',
  className = '',
  imageClassName = '',
  onOrientationChange,
}) => {
  const [orientation, setOrientation] = useState<ImageOrientation>('unknown');
  const shouldContain = orientation === 'portrait' || orientation === 'square';

  useEffect(() => {
    setOrientation('unknown');
    if (!src) {
      onOrientationChange?.('unknown');
    }
  }, [src, onOrientationChange]);

  if (!src) {
    return <StaticImagePlaceholder kind={kind} className={className} />;
  }

  return (
    <div className={`relative w-full h-full overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 ${className}`}>
      {shouldContain && (
        <>
          <img
            src={src}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-35"
          />
          <div className="absolute inset-0 bg-white/25" />
        </>
      )}
      <img
        src={src}
        alt={alt}
        onLoad={(event) => {
          const next = getOrientation(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          setOrientation(next);
          onOrientationChange?.(next);
        }}
        className={shouldContain
          ? `relative z-10 w-full h-full object-contain p-3 ${imageClassName}`
          : `w-full h-full object-cover ${imageClassName}`}
      />
    </div>
  );
};
