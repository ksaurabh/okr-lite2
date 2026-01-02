import type { ReactNode } from 'react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Button } from './Button';

interface SlidePaneProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  customWidth?: number;
  onWidthChange?: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
}

const defaultWidths = {
  sm: 384,  // 24rem
  md: 448,  // 28rem
  lg: 512,  // 32rem
};

export function SlidePane({
  isOpen,
  onClose,
  title,
  children,
  width = 'md',
  customWidth,
  onWidthChange,
  minWidth = 320,
  maxWidth = 800,
}: SlidePaneProps) {
  const [currentWidth, setCurrentWidth] = useState(customWidth || defaultWidths[width]);
  const [isResizing, setIsResizing] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  // Update width when customWidth prop changes
  useEffect(() => {
    if (customWidth) {
      setCurrentWidth(customWidth);
    }
  }, [customWidth]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const newWidth = window.innerWidth - e.clientX;
    const clampedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth);
    setCurrentWidth(clampedWidth);
  }, [isResizing, minWidth, maxWidth]);

  const handleMouseUp = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      if (onWidthChange) {
        onWidthChange(currentWidth);
      }
    }
  }, [isResizing, currentWidth, onWidthChange]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 transition-opacity"
        onClick={onClose}
      />

      {/* Slide Pane */}
      <div
        ref={paneRef}
        style={{ width: currentWidth }}
        className="absolute right-0 top-0 h-full bg-white shadow-2xl flex flex-col"
      >
        {/* Resize Handle */}
        <div
          onMouseDown={handleMouseDown}
          className={`absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-500 transition-colors ${
            isResizing ? 'bg-blue-500' : 'bg-transparent hover:bg-blue-300'
          }`}
          title="Drag to resize"
        />

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
