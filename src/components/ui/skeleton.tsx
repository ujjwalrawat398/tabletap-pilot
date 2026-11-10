import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden {...props} />;
}

export function SkeletonCard() {
  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}
