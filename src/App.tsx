import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/layout';
import { ObjectiveTree, ObjectiveForm } from './components/objectives';
import { AdminPage } from './components/admin';
import { LoginPage, UnauthorizedPage, AuthCallback } from './components/auth';
import { Modal } from './components/common';

type View = 'objectives' | 'teams' | 'periods' | 'tags' | 'admin';

function AppContent() {
  const [currentView, setCurrentView] = useState<View>('objectives');
  const [showAddObjective, setShowAddObjective] = useState(false);
  const { isLoading, isAuthenticated, isAllowed } = useAuth();

  // Handle OAuth callback
  if (window.location.pathname === '/auth/callback') {
    return <AuthCallback />;
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
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
      {currentView === 'objectives' && <ObjectiveTree />}
      {currentView === 'teams' && (
        <div className="text-center py-12 text-gray-500">
          <p>Manage teams from the sidebar</p>
        </div>
      )}
      {currentView === 'periods' && (
        <div className="text-center py-12 text-gray-500">
          <p>Manage periods from the sidebar</p>
        </div>
      )}
      {currentView === 'tags' && (
        <div className="text-center py-12 text-gray-500">
          <p>Manage tags from the sidebar</p>
        </div>
      )}
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
