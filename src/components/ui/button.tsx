import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[.99]',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        outline: 'border-2 border-border bg-card hover:bg-secondary',
        ghost: 'hover:bg-secondary text-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        success: 'bg-[hsl(var(--success))] text-white hover:opacity-90',
        warning: 'bg-[hsl(var(--warning))] text-black hover:opacity-90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-14 px-6 text-base',
        xl: 'h-16 px-8 text-lg',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={props.disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden
            />
            <span>{children}</span>
          </span>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
