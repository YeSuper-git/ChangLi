import React, { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

interface PageMotionProps {
  children: React.ReactNode;
  motionKey: string;
}

const PageMotion: React.FC<PageMotionProps> = ({ children, motionKey }) => {
  const scopeRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !scopeRef.current) return;

    const sections = scopeRef.current.querySelectorAll('section, .card, h1, h2, .category-btn, .search-input');
    const cards = scopeRef.current.querySelectorAll('.card');

    gsap.fromTo(
      sections,
      { autoAlpha: 0, y: 18 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.46,
        stagger: 0.025,
        ease: 'power3.out',
        overwrite: 'auto',
      }
    );

    gsap.fromTo(
      cards,
      { scale: 0.985 },
      {
        scale: 1,
        duration: 0.42,
        stagger: 0.018,
        ease: 'power2.out',
        overwrite: 'auto',
      }
    );
  }, { scope: scopeRef, dependencies: [motionKey], revertOnUpdate: true });

  return (
    <div ref={scopeRef} className="changli-page-motion">
      {children}
    </div>
  );
};

export default PageMotion;
