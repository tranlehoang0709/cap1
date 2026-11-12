import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const variants = cva('btn', { variants: { variant: { default: 'btn-primary', outline: 'btn-outline', ghost: 'btn-ghost', destructive: 'btn-danger' } }, defaultVariants: { variant: 'default' } });
export function Button({ className, variant, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof variants> & {
    asChild?: boolean;
}) { const Comp = asChild ? Slot.Root : 'button'; return <Comp className={cn(variants({ variant }), className)} {...props}/>; }
