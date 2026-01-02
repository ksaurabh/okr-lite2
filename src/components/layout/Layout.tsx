import type { ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

type View = 'objectives' | 'teams' | 'periods' | 'tags' | 'admin';

interface LayoutProps {
  children: ReactNode;
  currentView: View;
  onViewChange: (view: View) => void;
  onAddObjective: () => void;
}

export function Layout({ children, currentView, onViewChange, onAddObjective }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-100">
      <Header onAddObjective={onAddObjective} />
      <div className="flex">
        <Sidebar currentView={currentView} onViewChange={onViewChange} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
