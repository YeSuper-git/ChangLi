import React, { useState, useEffect } from 'react';

interface FloatingActionsProps {
  onRefresh?: () => void;
  refreshLabel?: string;
}

const FloatingActions: React.FC<FloatingActionsProps> = ({ onRefresh, refreshLabel = '刷新' }) => {
  const [refreshing, setRefreshing] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Toast auto-dismiss
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
      setToast({ message: '刷新成功', type: 'success' });
    } catch (error) {
      setToast({ message: '刷新失败', type: 'error' });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <div className="fixed right-6 bottom-6 z-50 flex flex-col gap-3 items-end">
        {onRefresh && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-12 h-12 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white shadow-lg flex items-center justify-center cursor-pointer disabled:opacity-50"
            aria-label={refreshLabel}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </button>
        )}
        <button
          onClick={scrollToTop}
          className={`w-12 h-12 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white shadow-lg flex items-center justify-center cursor-pointer transition-opacity duration-300 ${showScrollTop ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          aria-label="返回顶部"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      {/* Toast notification */}
      {toast && (
        <div className="fixed z-[60]" style={{ right: '24px', bottom: onRefresh ? (showScrollTop ? '156px' : '96px') : (showScrollTop ? '96px' : '24px'), animation: 'fadeIn 0.3s ease-in' }}>
          <div className={`px-4 py-3 rounded-xl shadow-xl text-sm border ${toast.type === 'success' ? 'bg-white border-gray-300 text-gray-900' : 'bg-white border-red-300 text-red-700'}`}>
            {toast.message}
          </div>
        </div>
      )}
    </>
  );
};

export default FloatingActions;
