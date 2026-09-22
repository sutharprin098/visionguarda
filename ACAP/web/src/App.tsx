import React, { useState } from 'react';
import AdminStudio from './screens/AdminStudio';
import Workspace from './screens/Workspace';

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'studio' | 'workspace'>('workspace');

  return (
    <div className="w-screen h-screen bg-surface-0 text-zinc-100 overflow-hidden select-none font-sans">
      {currentScreen === 'studio' ? (
        <AdminStudio onBackToWorkspace={() => setCurrentScreen('workspace')} />
      ) : (
        <Workspace onOpenAdminStudio={() => setCurrentScreen('studio')} />
      )}
    </div>
  );
};

export default App;
