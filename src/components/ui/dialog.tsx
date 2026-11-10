'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  hideClose,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  hideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-3xl border-t border-border bg-card p-5 shadow-card',
          'sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[520px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border',
          'data-[state=open]:animate-slide-up sm:data-[state=open]:animate-fade-in',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="pr-10 text-lg font-semibold">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        <div className="mt-4">{children}</div>
        {!hideClose && (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
