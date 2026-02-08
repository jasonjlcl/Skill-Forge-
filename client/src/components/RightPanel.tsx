import { useEffect, useMemo, useRef, type ComponentType } from 'react';
import { FileText, Lightbulb, ListChecks, X } from 'lucide-react';
import type { Message, Source } from '../types';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { cn } from '../lib/utils';

export type RightPanelTab = 'explain' | 'sources' | 'steps';

interface RightPanelProps {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  message: Message | null;
  explanation: string | null;
  sources: Source[];
  focusedSourceId?: string | null;
  notes: string;
  onNotesChange: (value: string) => void;
  explainLoading?: boolean;
  onClose?: () => void;
  className?: string;
}

const tabs: Array<{ id: RightPanelTab; label: string; icon: ComponentType<{ size?: string | number }> }> = [
  { id: 'explain', label: 'Explain Why', icon: Lightbulb },
  { id: 'sources', label: 'Sources', icon: FileText },
  { id: 'steps', label: 'Key Steps', icon: ListChecks },
];

const extractSteps = (message: Message | null): string[] => {
  if (!message?.content) {
    return [];
  }

  const lines = message.content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const extracted = lines
    .filter((line) => /^\d+\)|^\d+\.|^-|^\*/.test(line) || line.toLowerCase().includes('step'))
    .slice(0, 6)
    .map((line) => line.replace(/^\d+\)|^\d+\.|^-|^\*/, '').trim());

  if (extracted.length > 0) {
    return extracted;
  }

  return lines.slice(0, 4);
};

export const RightPanel = ({
  activeTab,
  onTabChange,
  message,
  explanation,
  sources,
  focusedSourceId,
  notes,
  onNotesChange,
  explainLoading,
  onClose,
  className,
}: RightPanelProps) => {
  const sourceRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (activeTab !== 'sources' || !focusedSourceId) {
      return;
    }

    sourceRefs.current[focusedSourceId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [activeTab, focusedSourceId]);

  const keySteps = useMemo(() => extractSteps(message), [message]);

  return (
    <section
      className={cn(
        'flex h-full min-h-0 flex-col rounded-2xl border border-white/15 bg-black/25 text-slate-100 shadow-[0_40px_80px_-60px_rgba(34,211,238,0.5)] backdrop-blur-xl',
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="text-sm font-semibold tracking-wide text-slate-100">Trust & Context Panel</p>
        {onClose ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full border border-white/10 bg-white/5 text-slate-200 hover:bg-white/15"
            title="Close panel"
            onClick={onClose}
          >
            <X size={14} />
          </Button>
        ) : null}
      </header>

      <div className="grid grid-cols-3 gap-1 p-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-medium transition',
                active
                  ? 'bg-cyan-300/20 text-cyan-100 ring-1 ring-cyan-300/40'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-slate-100',
              )}
              onClick={() => onTabChange(tab.id)}
            >
              <Icon size={13} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === 'explain' ? (
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Reasoning</p>
            {explainLoading ? (
              <div className="space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-white/15" />
                <div className="h-3 w-full animate-pulse rounded bg-white/15" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-white/15" />
              </div>
            ) : explanation ? (
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{explanation}</p>
            ) : (
              <p className="text-sm text-slate-400">
                Select an assistant message and press Explain Why to inspect model reasoning.
              </p>
            )}
          </div>
        ) : null}

        {activeTab === 'sources' ? (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Retrieved Sources</p>
            {sources.length === 0 ? (
              <p className="text-sm text-slate-400">No sources available for this response.</p>
            ) : (
              sources.map((source, index) => (
                <div
                  key={source.id}
                  ref={(node) => {
                    sourceRefs.current[source.id] = node;
                  }}
                  className={cn(
                    'rounded-xl border border-white/10 bg-white/5 p-3',
                    focusedSourceId === source.id && 'ring-1 ring-violet-300/60',
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-200">
                    Source {index + 1}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-100">{source.source}</p>
                  <p className="mt-1 text-xs text-slate-400">Relevance score: {(source.score * 100).toFixed(0)}%</p>
                  <p className="mt-2 text-sm text-slate-300">
                    {source.excerpt ?? 'Open the source for full SOP context in your repository.'}
                  </p>
                </div>
              ))
            )}
          </div>
        ) : null}

        {activeTab === 'steps' ? (
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Operational Notes</p>
            {keySteps.length === 0 ? (
              <p className="text-sm text-slate-400">No key steps extracted yet.</p>
            ) : (
              <ol className="space-y-2 text-sm text-slate-200">
                {keySteps.map((step, index) => (
                  <li key={`${step}-${index}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <span className="mr-2 text-cyan-300">{index + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
            )}

            <div>
              <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400">Your note</label>
              <Textarea
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Capture a quick operator note or checklist reminder."
                className="min-h-[120px]"
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};

