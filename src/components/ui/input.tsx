import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-xl border-2 border-input bg-card px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[80px] w-full rounded-xl border-2 border-input bg-card px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn('text-sm font-medium text-foreground', className)} {...props} />
));
Label.displayName = 'Label';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-11 w-full rounded-xl border-2 border-input bg-card px-3 text-base focus-visible:border-primary focus-visible:outline-none',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';
