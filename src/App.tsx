import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/layout';
import { DashboardPage } from './components/dashboard';
import { ObjectiveTree, ObjectiveForm } from './components/objectives';
import { ChecklistPage } from './components/checklist';
import { ProgressPage } from './components/progress';
import { PeriodsPage } from './components/periods';
import { UpdatesPage } from './components/updates';
import { ListsPage } from './components/lists';
import { AdminPage } from './components/admin';
import { SettingsPage } from './components/settings';
import { LoginPage, UnauthorizedPage, AuthCallback, AdminInviteAccept } from './components/auth';
import { Modal } from './components/common';
import { useOKRStore } from './store/okrStore';

type View = 'dashboard' | 'objectives' | 'checklist' | 'progress' | 'updates' | 'lists' | 'teams' | 'periods' | 'tags' | 'settings' | 'admin';

function AppContent() {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [showAddObjective, setShowAddObjective] = useState(false);
  const { isLoading, isAuthenticated, isAllowed } = useAuth();
  const fetchData = useOKRStore((state) => state.fetchData);
  const fetchUserPreferences = useOKRStore((state) => state.fetchUserPreferences);
  const fetchViews = useOKRStore((state) => state.fetchViews);
  const fetchLists = useOKRStore((state) => state.fetchLists);
  const isDataLoading = useOKRStore((state) => state.isLoading);

  // Fetch OKR data, user preferences, views, and lists when authenticated
  useEffect(() => {
    if (isAuthenticated && isAllowed) {
      fetchData();
      fetchUserPreferences();
      fetchViews();
      fetchLists();
    }
  }, [isAuthenticated, isAllowed, fetchData, fetchUserPreferences, fetchViews, fetchLists]);

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
    <Layout
      currentView={currentView}
      onViewChange={setCurrentView}
      onAddObjective={() => setShowAddObjective(true)}
    >
      {currentView === 'dashboard' && <DashboardPage onViewChange={setCurrentView} />}
      {currentView === 'objectives' && <ObjectiveTree />}
      {currentView === 'checklist' && <ChecklistPage />}
      {currentView === 'progress' && <ProgressPage />}
      {currentView === 'updates' && <UpdatesPage />}
      {currentView === 'lists' && <ListsPage />}
      {currentView === 'teams' && (
        <div className="text-center py-12 text-gray-500">
          <p>Manage teams from the sidebar</p>
        </div>
      )}
      {currentView === 'periods' && <PeriodsPage />}
      {currentView === 'tags' && (
        <div className="text-center py-12 text-gray-500">
          <p>Manage tags from the sidebar</p>
        </div>
      )}
      {currentView === 'settings' && <SettingsPage />}
      {currentView === 'admin' && <AdminPage />}

      <Modal
        isOpen={showAddObjective}
        onClose={() => setShowAddObjective(false)}
        title="Create Objective"
      >
        <ObjectiveForm onClose={() => setShowAddObjective(false)} />
      </Modal>
    </Layout>
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
