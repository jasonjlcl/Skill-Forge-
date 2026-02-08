import { BookOpenCheck, ClipboardCopy, Compass, Lightbulb, Link2 } from 'lucide-react';
import type { Message } from '../types';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface MessageBubbleProps {
  message: Message;
  isActive?: boolean;
  onSelect?: (message: Message) => void;
  onExplain?: (message: Message) => void;
  onViewSources?: (message: Message, sourceId?: string) => void;
  onCopy?: (message: Message) => void;
  onCreateQuiz?: (message: Message) => void;
}

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

const StreamingDots = () => (
  <span className="inline-flex items-center gap-1" aria-live="polite" aria-label="Assistant is typing">
    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.2s]" />
    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.1s]" />
    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300" />
  </span>
);

export const MessageBubble = ({
  message,
  isActive,
  onSelect,
  onExplain,
  onViewSources,
  onCopy,
  onCreateQuiz,
}: MessageBubbleProps) => {
  const isUser = message.role === 'user';

  return (
    <article
      className={cn('group flex w-full', isUser ? 'justify-end' : 'justify-start')}
      onClick={() => onSelect?.(message)}
    >
      <div
        className={cn(
          'max-w-[92%] rounded-2xl border px-4 py-3 shadow-[0_20px_45px_-30px_rgba(15,23,42,0.9)] transition-all duration-300 sm:max-w-[80%]',
          isUser
            ? 'border-cyan-300/30 bg-gradient-to-br from-cyan-500/25 to-indigo-500/30 text-slate-50'
            : 'border-white/15 bg-white/5 text-slate-100 backdrop-blur-xl',
          isActive && !isUser && 'ring-1 ring-cyan-300/60',
        )}
      >
        <p className="whitespace-pre-wrap text-[15px] leading-6">
          {message.content || (message.isStreaming ? <StreamingDots /> : 'No response text was returned.')}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          {message.isStreaming ? (
            <span className="inline-flex items-center gap-1 text-cyan-200">
              <StreamingDots />
              <span>Streaming</span>
            </span>
          ) : null}
        </div>

        {!isUser ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                title="Explain why this answer is valid"
                className="h-8 rounded-full border border-white/10 bg-white/5 px-2.5 text-xs text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-300/10"
                onClick={(event) => {
                  event.stopPropagation();
                  onExplain?.(message);
                }}
              >
                <Lightbulb size={14} className="mr-1.5" />
                Explain Why
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="View retrieved sources"
                className="h-8 rounded-full border border-white/10 bg-white/5 px-2.5 text-xs text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-300/10"
                onClick={(event) => {
                  event.stopPropagation();
                  onViewSources?.(message);
                }}
              >
                <Compass size={14} className="mr-1.5" />
                View Sources
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Copy message"
                className="h-8 w-8 rounded-full border border-white/10 bg-white/5 text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-300/10"
                onClick={(event) => {
                  event.stopPropagation();
                  onCopy?.(message);
                }}
              >
                <ClipboardCopy size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Create quiz from this topic"
                className="h-8 rounded-full border border-white/10 bg-white/5 px-2.5 text-xs text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-300/10"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateQuiz?.(message);
                }}
              >
                <BookOpenCheck size={14} className="mr-1.5" />
                Create Quiz
              </Button>
            </div>

            {message.sources && message.sources.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {message.sources.map((source, index) => (
                  <button
                    key={source.id}
                    type="button"
                    title={`Open source ${index + 1}`}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-300/30 bg-violet-400/10 px-2 py-1 text-[11px] text-violet-100 transition hover:border-violet-200/50 hover:bg-violet-300/20"
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewSources?.(message, source.id);
                    }}
                  >
                    <Link2 size={11} />
                    {source.source}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
};

