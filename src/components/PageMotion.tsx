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

    if (motionKey.startsWith('/series/')) {
      gsap.fromTo(
        scopeRef.current,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.12, ease: 'power2.out', overwrite: 'auto' }
      );
      return;
    }

    if (motionKey.startsWith('/library')) {
      const header = scopeRef.current.querySelector('.changli-page-header');
      const filters = scopeRef.current.querySelector('.changli-filter-panel');
      const toolbar = scopeRef.current.querySelector('.changli-toolbar');
      const cards = gsap.utils.toArray<HTMLElement>(scopeRef.current.querySelectorAll('.card'));
      const tl = gsap.timeline({ defaults: { ease: 'power3.out', overwrite: 'auto' } });

      if (header) {
        tl.fromTo(header, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.24 });
      }
      if (filters) {
        tl.fromTo(
          filters,
          { autoAlpha: 0, y: 18, scale: 0.992 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.34 },
          header ? '-=0.08' : 0
        );
      }
      if (toolbar) {
        tl.fromTo(
          toolbar,
          { autoAlpha: 0, y: 14, scale: 0.994 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.30 },
          filters ? '-=0.22' : 0
        );
      }
      if (cards.length > 0) {
        tl.fromTo(
          cards,
          { autoAlpha: 0, y: 12, scale: 0.988 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.34, stagger: 0.012 },
          '-=0.12'
        );
      }
      return;
    }

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
