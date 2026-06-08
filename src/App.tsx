import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/layout';
import { DashboardPage } from './components/dashboard';
import { ObjectiveTree, ObjectiveForm } from './components/objectives';
import { ChecklistPage } from './components/checklist';
import { ProgressPage } from './components/progress';
import { PeriodsPage } from './components/periods';
import { TeamsPage } from './components/teams/TeamsPage';
import { PlansPage } from './components/plans/PlansPage';
import { PlanBuilderPage } from './components/plans/PlanBuilderPage';
import { WeeklyUpdatesPage } from './components/weeklyupdates/WeeklyUpdatesPage';
import { UpdatesPage } from './components/updates';
import { ListsPage } from './components/lists';
import { ViewsPage } from './components/views';
import { LogWorkPage } from './components/logwork';
import { LogsPage } from './components/logs';
import { AdminPage } from './components/admin';
import { SettingsPage } from './components/settings';
import { LoginPage, UnauthorizedPage, AuthCallback, AdminInviteAccept } from './components/auth';
import { Modal } from './components/common';
import { useOKRStore } from './store/okrStore';

type View = 'dashboard' | 'objectives' | 'plans' | 'planbuilder' | 'weeklyupdates' | 'views' | 'checklist' | 'progress' | 'updates' | 'lists' | 'logwork' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin' | 'logs';

const ALL_VIEWS: View[] = ['dashboard', 'objectives', 'plans', 'planbuilder', 'weeklyupdates', 'views', 'checklist', 'progress', 'updates', 'lists', 'logwork', 'teams', 'periods', 'tags', 'settings', 'admin', 'logs'];
const RESERVED_PATHS = new Set(['/auth/callback', '/invite/accept']);

function viewFromPath(pathname: string): View {
  if (RESERVED_PATHS.has(pathname)) return 'dashboard';
  const seg = pathname.replace(/^\/+/, '').split('/')[0];
  if (!seg) return 'dashboard';
  return (ALL_VIEWS as string[]).includes(seg) ? (seg as View) : 'dashboard';
}

function pathFromView(view: View): string {
  return view === 'dashboard' ? '/' : `/${view}`;
}

function AppContent() {
  const [currentView, setCurrentViewState] = useState<View>(() => viewFromPath(window.location.pathname));

  const setCurrentView = (view: View) => {
    setCurrentViewState(view);
    const path = pathFromView(view);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      setCurrentViewState(viewFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const [showAddObjective, setShowAddObjective] = useState(false);
  const [highlightObjectiveId, setHighlightObjectiveId] = useState<string | null>(null);

  const handleNavigateToObjective = (objectiveId: string) => {
    setHighlightObjectiveId(objectiveId);
    setCurrentView('objectives');
  };
  const { isLoading, isAuthenticated, isAllowed } = useAuth();
  const fetchData = useOKRStore((state) => state.fetchData);
  const fetchUserPreferences = useOKRStore((state) => state.fetchUserPreferences);
  const fetchViews = useOKRStore((state) => state.fetchViews);
  const fetchLists = useOKRStore((state) => state.fetchLists);
  const fetchSharedPlans = useOKRStore((state) => state.fetchSharedPlans);
  const isDataLoading = useOKRStore((state) => state.isLoading);

  // Fetch OKR data, user preferences, views, and lists when authenticated
  useEffect(() => {
    if (isAuthenticated && isAllowed) {
      fetchData();
      fetchUserPreferences();
      fetchViews();
      fetchLists();
      fetchSharedPlans();
    }
  }, [isAuthenticated, isAllowed, fetchData, fetchUserPreferences, fetchViews, fetchLists, fetchSharedPlans]);

  // Handle OAuth callback
  if (window.location.pathname === '/auth/callback') {
    return <AuthCallback />;
  }

  // Handle admin invite accept
  if (window.location.pathname === '/invite/accept') {
    return <AdminInviteAccept />;
  }

  // Show loading state
  if (isLoading || (isAuthenticated && isAllowed && isDataLoading)) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{isDataLoading ? 'Loading data...' : 'Loading...'}</p>
        </div>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Show unauthorized page if authenticated but domain not allowed
  if (!isAllowed) {
    return <UnauthorizedPage />;
  }

  // Show main app if authenticated and allowed
  return (
    <>
      <ServerStatusBanner />
    <Layout
      currentView={currentView}
      onViewChange={setCurrentView}
      onAddObjective={() => setShowAddObjective(true)}
    >
      {currentView === 'dashboard' && <DashboardPage onViewChange={setCurrentView} />}
      {currentView === 'objectives' && <ObjectiveTree highlightObjectiveId={highlightObjectiveId} onHighlightClear={() => setHighlightObjectiveId(null)} onViewChange={setCurrentView} />}
      {currentView === 'plans' && <PlansPage onViewChange={setCurrentView} />}
      {currentView === 'planbuilder' && <PlanBuilderPage onViewChange={setCurrentView} />}
      {currentView === 'weeklyupdates' && <WeeklyUpdatesPage />}
      {currentView === 'views' && <ViewsPage onViewChange={setCurrentView} />}
      {currentView === 'checklist' && <ChecklistPage />}
      {currentView === 'progress' && <ProgressPage />}
      {currentView === 'updates' && <UpdatesPage />}
      {currentView === 'lists' && <ListsPage onViewChange={setCurrentView} />}
      {currentView === 'logwork' && <LogWorkPage />}
      {currentView === 'teams' && <TeamsPage />}
      {currentView === 'periods' && <PeriodsPage />}
      {currentView === 'tags' && (
        <div className="text-center py-12 text-gray-500">
          <p>Manage tags from the sidebar</p>
        </div>
      )}
      {currentView === 'settings' && <SettingsPage />}
      {currentView === 'admin' && <AdminPage />}
      {currentView === 'logs' && <LogsPage onNavigateToObjective={handleNavigateToObjective} />}

      <Modal
        isOpen={showAddObjective}
        onClose={() => setShowAddObjective(false)}
        title="Create Objective"
      >
        <ObjectiveForm onClose={() => setShowAddObjective(false)} />
      </Modal>
    </Layout>
    </>
  );
}

function ServerStatusBanner() {
  const { serverReachable } = useAuth();
  if (serverReachable) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-red-600 text-white text-sm text-center py-1.5 shadow-md">
      <span className="font-medium">Cannot reach the server.</span> Some actions may fail. Trying to reconnect…
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
