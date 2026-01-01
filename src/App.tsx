import { useState } from 'react';
import { Layout } from './components/layout';
import { ObjectiveTree, ObjectiveForm } from './components/objectives';
import { Modal } from './components/common';

type View = 'objectives' | 'teams' | 'periods' | 'tags';

function App() {
  const [currentView, setCurrentView] = useState<View>('objectives');
  const [showAddObjective, setShowAddObjective] = useState(false);

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

export default App;
