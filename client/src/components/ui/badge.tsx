import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const Badge = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-200',
      className,
    )}
    {...props}
  />
);

