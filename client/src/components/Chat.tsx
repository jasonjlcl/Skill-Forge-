import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelRightClose, PanelRightOpen, RotateCcw, SendHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useSSEChat } from '../hooks/useSSEChat';
import type { Message } from '../types';
import { MessageBubble } from './MessageBubble';
import { PromptChips } from './PromptChips';
import { RightPanel, type RightPanelTab } from './RightPanel';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

interface ChatProps {
  selectedModule: string;
  onCreateQuiz: () => void;
  onAnalyticsRefresh?: () => void | Promise<void>;
}

const errorCopy: Record<string, { title: string; body: string }> = {
  retrieval: {
    title: 'Context retrieval issue',
    body: 'I could not fetch enough training snippets. Try again or ask a narrower module-specific question.',
  },
  model: {
    title: 'Model response issue',
    body: 'The reasoning model returned an invalid response. Retry in a moment.',
  },
  network: {
    title: 'Connection issue',
    body: 'The response stream dropped due to network interruption. Retry to continue.',
  },
};

export const Chat = ({ selectedModule, onCreateQuiz, onAnalyticsRefresh }: ChatProps) => {
  const {
    messages,
    sessionId,
    isResponding,
    isLoadingHistory,
    error,
    prompts,
    send,
    retryLast,
    explain,
    clearError,
  } = useSSEChat({
    selectedModule,
    onAnalyticsRefresh,
  });

  const [draft, setDraft] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useLocalStorage<boolean>('chat_right_panel_open', true);
  const [activeTab, setActiveTab] = useLocalStorage<RightPanelTab>('chat_right_panel_tab', 'explain');
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [focusedSourceId, setFocusedSourceId] = useState<string | null>(null);
  const [notesByMessage, setNotesByMessage] = useLocalStorage<Record<string, string>>(
    'chat_notes_by_message',
    {},
  );
  const [isLoadingExplain, setIsLoadingExplain] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    if (!latestAssistant) {
      setSelectedMessageId(null);
      return;
    }

    if (!selectedMessageId || !messages.some((message) => message.id === selectedMessageId)) {
      setSelectedMessageId(latestAssistant.id);
    }
  }, [messages, selectedMessageId]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, isResponding]);

  const selectedMessage = useMemo(() => {
    const candidate = messages.find(
      (message) => message.id === selectedMessageId && message.role === 'assistant',
    );

    if (candidate) {
      return candidate;
    }

    return [...messages].reverse().find((message) => message.role === 'assistant') ?? null;
  }, [messages, selectedMessageId]);

  const panelNotes = selectedMessage ? notesByMessage[selectedMessage.id] ?? '' : '';
  const panelSources = selectedMessage?.sources ?? [];

  const openPanel = (tab: RightPanelTab, message: Message, sourceId?: string) => {
    setSelectedMessageId(message.id);
    setFocusedSourceId(sourceId ?? null);
    setActiveTab(tab);
    setPanelOpen(true);

    if (window.matchMedia('(max-width: 1279px)').matches) {
      setMobilePanelOpen(true);
    }
  };

  const handleExplain = async (message: Message) => {
    openPanel('explain', message);
    if (message.explainWhy) {
      return;
    }

    setIsLoadingExplain(true);
    try {
      await explain(message.id);
      void onAnalyticsRefresh?.();
    } catch {
      // errors are handled in hook state
    } finally {
      setIsLoadingExplain(false);
    }
  };

  const sendDraft = () => {
    if (!draft.trim() || isResponding) {
      return;
    }

    send(draft);
    setDraft('');
  };

  return (
    <>
      <div
        className={cn(
          'grid h-full min-h-0 gap-3',
          panelOpen ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : 'xl:grid-cols-1',
        )}
      >
        <section className="flex min-h-0 flex-col rounded-2xl border border-white/15 bg-black/30 backdrop-blur-xl">
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">{selectedModule} Chat Trainer</h2>
              <p className="text-xs text-slate-400">
                {sessionId ? `Session ${sessionId.slice(0, 8)}` : 'New conversation'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {error ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full border border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20"
                  onClick={() => {
                    clearError();
                    retryLast();
                  }}
                >
                  <RotateCcw size={14} className="mr-1.5" />
                  Retry
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                title={panelOpen ? 'Collapse trust panel' : 'Open trust panel'}
                className="h-8 rounded-full border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
                onClick={() => {
                  setPanelOpen((value) => !value);
                  if (!panelOpen && window.matchMedia('(max-width: 1279px)').matches) {
                    setMobilePanelOpen(true);
                  }
                }}
              >
                {panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </Button>
            </div>
          </header>

          {error ? (
            <div className="mx-4 mt-3 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
              <p className="font-medium">{errorCopy[error.kind].title}</p>
              <p className="mt-1 text-rose-100/90">{errorCopy[error.kind].body}</p>
            </div>
          ) : null}

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {isLoadingHistory ? (
              <div className="space-y-3">
                <div className="h-16 w-[78%] animate-pulse rounded-2xl border border-white/10 bg-white/5" />
                <div className="ml-auto h-14 w-[62%] animate-pulse rounded-2xl border border-cyan-300/20 bg-cyan-300/10" />
                <div className="h-20 w-[70%] animate-pulse rounded-2xl border border-white/10 bg-white/5" />
              </div>
            ) : null}

            {!isLoadingHistory && messages.length === 0 ? (
              <PromptChips
                prompts={prompts}
                onPick={(prompt) => {
                  setDraft(prompt);
                }}
              />
            ) : null}

            {!isLoadingHistory
              ? messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isActive={message.id === selectedMessage?.id}
                    onSelect={(entry) => {
                      if (entry.role === 'assistant') {
                        setSelectedMessageId(entry.id);
                      }
                    }}
                    onExplain={(entry) => {
                      void handleExplain(entry);
                    }}
                    onViewSources={(entry, sourceId) => {
                      openPanel('sources', entry, sourceId);
                    }}
                    onCopy={(entry) => {
                      void navigator.clipboard.writeText(entry.content);
                    }}
                    onCreateQuiz={() => {
                      onCreateQuiz();
                    }}
                  />
                ))
              : null}
          </div>

          <footer className="border-t border-white/10 bg-black/20 p-3">
            <form
              className="rounded-2xl border border-white/15 bg-black/30 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendDraft();
              }}
            >
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={`Ask about ${selectedModule.toLowerCase()}...`}
                className="min-h-[64px] border-none bg-transparent text-[15px] leading-6 focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendDraft();
                  }
                }}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-slate-400">Enter to send, Shift+Enter for a new line.</p>
                <Button
                  type="submit"
                  disabled={!draft.trim() || isResponding}
                  className="rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-950 hover:from-cyan-300 hover:to-violet-400"
                >
                  <SendHorizontal size={15} className="mr-1.5" />
                  {isResponding ? 'Streaming...' : 'Send'}
                </Button>
              </div>
            </form>
          </footer>
        </section>

        {panelOpen ? (
          <div className="hidden min-h-0 xl:block">
            <RightPanel
              activeTab={activeTab}
              onTabChange={setActiveTab}
              message={selectedMessage}
              explanation={selectedMessage?.explainWhy ?? null}
              sources={panelSources}
              focusedSourceId={focusedSourceId}
              notes={panelNotes}
              explainLoading={isLoadingExplain}
              onNotesChange={(value) => {
                if (!selectedMessage) {
                  return;
                }
                setNotesByMessage((previous) => ({
                  ...previous,
                  [selectedMessage.id]: value,
                }));
              }}
            />
          </div>
        ) : null}
      </div>

      {mobilePanelOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Close panel"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobilePanelOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 p-2">
            <RightPanel
              className="h-[78vh]"
              activeTab={activeTab}
              onTabChange={setActiveTab}
              message={selectedMessage}
              explanation={selectedMessage?.explainWhy ?? null}
              sources={panelSources}
              focusedSourceId={focusedSourceId}
              notes={panelNotes}
              explainLoading={isLoadingExplain}
              onClose={() => setMobilePanelOpen(false)}
              onNotesChange={(value) => {
                if (!selectedMessage) {
                  return;
                }
                setNotesByMessage((previous) => ({
                  ...previous,
                  [selectedMessage.id]: value,
                }));
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
};

