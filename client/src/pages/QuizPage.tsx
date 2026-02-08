import { Quiz } from '../components/Quiz';
import { useAppState } from '../context/AppStateContext';

export const QuizPage = () => {
  const { selectedModule, refreshAnalytics } = useAppState();

  return <Quiz selectedModule={selectedModule} onAnalyticsRefresh={refreshAnalytics} />;
};

