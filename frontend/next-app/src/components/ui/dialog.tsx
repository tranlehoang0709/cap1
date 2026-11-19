'use client';
import { useEffect, useRef } from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { X } from 'lucide-react';

const FOCUSABLE_SELECTOR =
  'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  busy = false,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && typeof document !== 'undefined') {
      const active = document.activeElement;
      if (active instanceof HTMLElement && !contentRef.current?.contains(active)) {
        triggerRef.current = active;
      }
    }
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && busy) {
      e.preventDefault();
      return;
    }
    if (e.key !== 'Tab' || !contentRef.current) return;
    const items = Array.from(
      contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => el.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (!active || active === first || !contentRef.current.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (!active || active === last || !contentRef.current.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content
          ref={contentRef}
          className="dialog-content"
          onKeyDown={handleKeyDown}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            const active = document.activeElement;
            if (active instanceof HTMLElement && !contentRef.current?.contains(active)) {
              triggerRef.current = active;
            }
            const firstField = contentRef.current?.querySelector<HTMLElement>(
              'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])'
            );
            if (firstField) {
              e.preventDefault();
              firstField.focus();
            }
          }}
          onCloseAutoFocus={(e) => {
            if (triggerRef.current && triggerRef.current.isConnected) {
              e.preventDefault();
              triggerRef.current.focus();
            }
          }}
        >
          <div className="dialog-heading">
            <Primitive.Title>{title}</Primitive.Title>
            <Primitive.Close
              className="icon-button"
              aria-label="Đóng hộp thoại"
              disabled={busy}
            >
              <X size={18} />
            </Primitive.Close>
          </div>
          <Primitive.Description className="muted">
            {description || 'Kiểm tra thông tin trước khi gửi tới Backend.'}
          </Primitive.Description>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
