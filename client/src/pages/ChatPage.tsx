import { useNavigate } from 'react-router-dom';
import { Chat } from '../components/Chat';
import { useAppState } from '../context/AppStateContext';

export const ChatPage = () => {
  const { selectedModule, refreshAnalytics } = useAppState();
  const navigate = useNavigate();

  return (
    <Chat
      selectedModule={selectedModule}
      onCreateQuiz={() => {
        navigate('/quiz');
      }}
      onAnalyticsRefresh={refreshAnalytics}
    />
  );
};

