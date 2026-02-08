import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explainMessage, sendMessage } from '../lib/api';
import type { ChatErrorKind, ChatErrorState, Message, Source } from '../types';

const classifyError = (value: string): ChatErrorKind => {
  const normalized = value.toLowerCase();
  if (normalized.includes('retriev') || normalized.includes('source')) {
    return 'retrieval';
  }
  if (
    normalized.includes('model') ||
    normalized.includes('llm') ||
    normalized.includes('gemini') ||
    normalized.includes('openai')
  ) {
    return 'model';
  }
  return 'network';
};

export const getSuggestedPromptsForModule = (module: string): string[] => [
  `What safety checks should I run before starting ${module}?`,
  `Explain the most common mistakes operators make in ${module}.`,
  `Give me a step-by-step SOP summary for ${module}.`,
  `What should I do if a quality reading is out of tolerance in ${module}?`,
  `Quiz me on high-risk decisions in ${module}.`,
];

interface UseSSEChatOptions {
  selectedModule: string;
  onAnalyticsRefresh?: () => void | Promise<void>;
}

export interface ExplainPayload {
  explanation: string;
  sources: Source[];
}

export const useSSEChat = ({ selectedModule, onAnalyticsRefresh }: UseSSEChatOptions) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [error, setError] = useState<ChatErrorState | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const closeStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  const setErrorState = useCallback((message: string) => {
    setError({
      kind: classifyError(message),
      message,
    });
  }, []);

  useEffect(() => {
    closeStream();
    setMessages([]);
    setSessionId(null);
    setError(null);
    setIsResponding(false);
    setIsLoadingHistory(true);

    const timer = window.setTimeout(() => {
      setIsLoadingHistory(false);
    }, 480);

    return () => {
      window.clearTimeout(timer);
    };
  }, [selectedModule, closeStream]);

  useEffect(() => {
    return () => {
      closeStream();
    };
  }, [closeStream]);

  const send = useCallback(
    (rawInput: string) => {
      const content = rawInput.trim();
      if (!content || isResponding) {
        return;
      }

      setError(null);
      setIsResponding(true);

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };

      const assistantMessageId = crypto.randomUUID();
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        question: content,
        isStreaming: true,
        createdAt: new Date().toISOString(),
      };

      setMessages((previous) => [...previous, userMessage, assistantMessage]);
      closeStream();

      const stream = sendMessage(
        {
          message: content,
          module: selectedModule,
          sessionId: sessionId ?? undefined,
          timeSeconds: 18,
        },
        {
          onMeta: (payload) => {
            setSessionId(payload.sessionId);
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      sources: payload.sources,
                    }
                  : message,
              ),
            );
          },
          onToken: (payload) => {
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: `${message.content}${payload.token}`,
                      isStreaming: true,
                    }
                  : message,
              ),
            );
          },
          onDone: (payload) => {
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: message.content || payload.answer,
                      isStreaming: false,
                    }
                  : message,
              ),
            );
            setIsResponding(false);
            closeStream();
            void onAnalyticsRefresh?.();
          },
          onError: () => {
            setErrorState('Network connection was interrupted while streaming the answer.');
            setIsResponding(false);
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      isStreaming: false,
                      content:
                        message.content ||
                        'I could not finish streaming the response. Press retry to request it again.',
                    }
                  : message,
              ),
            );
            closeStream();
          },
        },
      );

      streamRef.current = stream;
    },
    [closeStream, isResponding, onAnalyticsRefresh, selectedModule, sessionId, setErrorState],
  );

  const retryLast = useCallback(() => {
    const latestUser = [...messagesRef.current].reverse().find((message) => message.role === 'user');
    if (latestUser) {
      send(latestUser.content);
    }
  }, [send]);

  const explain = useCallback(
    async (messageId: string): Promise<ExplainPayload> => {
      const target = messagesRef.current.find((message) => message.id === messageId);
      if (!target || target.role !== 'assistant') {
        throw new Error('Assistant message not found.');
      }

      const question =
        target.question ??
        [...messagesRef.current]
          .reverse()
          .find((message) => message.role === 'user')
          ?.content;

      if (!question) {
        throw new Error('Missing user question context for explanation.');
      }

      try {
        const payload = await explainMessage({
          sessionId: sessionId ?? undefined,
          module: selectedModule,
          question,
          answer: target.content,
        });

        setMessages((previous) =>
          previous.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  explainWhy: payload.explanation,
                  sources: payload.sources.length > 0 ? payload.sources : message.sources,
                }
              : message,
          ),
        );

        return payload;
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Could not generate explanation.';
        setErrorState(text);
        throw err;
      }
    },
    [selectedModule, sessionId, setErrorState],
  );

  const clearError = useCallback(() => setError(null), []);

  const prompts = useMemo(() => getSuggestedPromptsForModule(selectedModule), [selectedModule]);

  return {
    messages,
    sessionId,
    isResponding,
    isLoadingHistory,
    error,
    prompts,
    setMessages,
    send,
    retryLast,
    explain,
    clearError,
  };
};

