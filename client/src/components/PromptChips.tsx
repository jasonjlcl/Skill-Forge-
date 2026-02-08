import { Sparkles } from 'lucide-react';
import { Button } from './ui/button';

interface PromptChipsProps {
  prompts: string[];
  onPick: (prompt: string) => void;
}

export const PromptChips = ({ prompts, onPick }: PromptChipsProps) => {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-100">
        <Sparkles size={16} className="text-cyan-300" />
        Suggested prompts
      </div>
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <Button
            key={prompt}
            variant="ghost"
            size="sm"
            title={prompt}
            className="h-auto rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1.5 text-left text-xs text-cyan-100 hover:border-cyan-200/40 hover:bg-cyan-200/10"
            onClick={() => onPick(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  );
};

