import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppStateProvider, useAppState } from './context/AppStateContext';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AuthPage } from './pages/AuthPage';
import { ChatPage } from './pages/ChatPage';
import { QuizPage } from './pages/QuizPage';

const PlatformLayout = () => {
  const { selectedModule, setSelectedModule, modules } = useAppState();

  return (
    <AppShell modules={modules} selectedModule={selectedModule} onModuleChange={setSelectedModule}>
      <Outlet />
    </AppShell>
  );
};

const ProtectedApp = () => (
  <AppStateProvider>
    <PlatformLayout />
  </AppStateProvider>
);

const App = () => {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<ProtectedApp />}>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/quiz" element={<QuizPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
};

export default App;

