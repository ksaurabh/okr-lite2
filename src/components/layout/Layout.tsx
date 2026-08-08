import { useState, useCallback, type ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

type View = 'objectives' | 'plans' | 'plans-overview' | 'agent' | 'checklist' | 'progress' | 'updates' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin' | 'mindmaps' | 'mindmap';

const SIDEBAR_COLLAPSED_KEY = 'okr-sidebar-collapsed';

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore
  }
}

interface LayoutProps {
  children: ReactNode;
  currentView: View;
  onViewChange: (view: View) => void;
  onAddObjective: () => void;
}

export function Layout({ children, currentView, onViewChange, onAddObjective }: LayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(loadSidebarCollapsed);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsedState(prev => {
      const newValue = !prev;
      saveSidebarCollapsed(newValue);
      return newValue;
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <Header onAddObjective={onAddObjective} />
      <div className="flex">
        <Sidebar
          currentView={currentView}
          onViewChange={onViewChange}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />
        <main className="flex-1 min-w-0 p-6 overflow-x-auto">{children}</main>
      </div>
    </div>
  );
}
