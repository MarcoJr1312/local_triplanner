'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface SmartImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  iconClassName?: string;
}

export default function SmartImage({ src, alt, className = '', iconClassName = 'h-8 w-8' }: SmartImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50 text-brand-500 dark:from-brand-500/20 dark:to-brand-500/5 dark:text-brand-300 ${className}`}
        aria-label={alt}
      >
        <ImageOff className={iconClassName} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
