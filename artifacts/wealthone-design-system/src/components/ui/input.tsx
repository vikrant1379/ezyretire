import * as React from 'react';
import { cn } from '../../lib/utils';

export type InputProps = React.ComponentProps<'input'> & {
  formatWithCommas?: boolean;
};

const formatIndianNumber = (value: string | number | readonly string[] | undefined) => {
  if (value === undefined || Array.isArray(value)) return value;
  const raw = String(value).replace(/,/g, '');
  if (raw === '' || raw === '-') return raw;
  const sign = raw.startsWith('-') ? '-' : '';
  const unsigned = sign ? raw.slice(1) : raw;
  const [integer, decimal] = unsigned.split('.');
  const lastThree = integer.slice(-3);
  const leading = integer.slice(0, -3);
  const groupedLeading = leading.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${leading ? `${groupedLeading},${lastThree}` : lastThree}${decimal === undefined ? '' : `.${decimal}`}`;
};

/**
 * Commas shift every digit that follows them, so a caret offset is only stable
 * when it is expressed as "how many non-comma characters precede it".
 */
const countSignificant = (text: string, upTo: number) =>
  text.slice(0, upTo).replace(/,/g, '').length;

const caretForSignificant = (text: string, significant: number) => {
  if (significant <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === ',') continue;
    seen += 1;
    if (seen === significant) return index + 1;
  }
  return text.length;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      onChange,
      onFocus,
      onMouseUp,
      onKeyDown,
      inputMode,
      value,
      formatWithCommas = false,
      ...props
    },
    ref,
  ) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const pendingCaret = React.useRef<number | null>(null);

    const setRefs = React.useCallback(
      (element: HTMLInputElement | null) => {
        inputRef.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      },
      [ref],
    );

    // Reformatting replaces the whole value, which parks the caret at the end.
    // Re-anchor it to the character the user was editing.
    const restoreCaret = React.useCallback(() => {
      const element = inputRef.current;
      const significant = pendingCaret.current;
      if (!element || significant === null || document.activeElement !== element) return;
      const caret = caretForSignificant(element.value, significant);
      element.setSelectionRange(caret, caret);
    }, []);

    // The commit below covers the re-render, and the microtask queued in
    // onChange covers React rewriting a controlled value that did not change.
    React.useLayoutEffect(restoreCaret);

    const normalizeNumber = (next: string) => {
      if (next === '' || next === '-' || next.includes('e')) return next;
      const sign = next.startsWith('-') ? '-' : '';
      const unsigned = sign ? next.slice(1) : next;
      const [integer, decimal] = unsigned.split('.');
      const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
      return `${sign}${normalizedInteger}${decimal === undefined ? '' : `.${decimal.slice(0, 2)}`}`;
    };
    const selectZero = (element: HTMLInputElement) => {
      if (type === 'number' && Number(element.value) === 0) element.select();
    };
    return (
      <input
        type={formatWithCommas ? 'text' : type}
        inputMode={inputMode ?? (type === 'number' ? 'decimal' : undefined)}
        value={formatWithCommas ? formatIndianNumber(value) : value}
        onKeyDown={(event) => {
          // Deleting a separator alone would be undone by the next reformat, so
          // step over it and let the browser delete the adjacent digit.
          pendingCaret.current = null;
          if (formatWithCommas && !event.altKey && !event.ctrlKey && !event.metaKey) {
            const element = event.currentTarget;
            const start = element.selectionStart;
            const collapsed = start !== null && start === element.selectionEnd;
            if (collapsed && event.key === 'Backspace' && element.value[start - 1] === ',') {
              element.setSelectionRange(start - 1, start - 1);
            }
            if (collapsed && event.key === 'Delete' && element.value[start] === ',') {
              element.setSelectionRange(start + 1, start + 1);
            }
          }
          onKeyDown?.(event);
        }}
        onChange={(event) => {
          if (type === 'number' || formatWithCommas) {
            const element = event.currentTarget;
            const typed = element.value;
            const caret = element.selectionStart;
            const normalized = normalizeNumber(typed.replace(/,/g, ''));
            element.value = normalized;

            if (formatWithCommas && caret !== null) {
              // Stripped leading zeros and truncated decimals shorten the value;
              // keep the caret from drifting past the character it belonged to.
              const dropped = typed.replace(/,/g, '').length - normalized.length;
              const significant = Math.max(0, countSignificant(typed, caret) - Math.max(0, dropped));
              pendingCaret.current = significant;
              element.setSelectionRange(significant, significant);
              queueMicrotask(() => {
                restoreCaret();
                pendingCaret.current = null;
              });
            }
          }
          onChange?.(event);
        }}
        onFocus={(event) => { selectZero(event.currentTarget); onFocus?.(event); }}
        onMouseUp={(event) => {
          pendingCaret.current = null;
          if (type === 'number' && Number(event.currentTarget.value) === 0) event.preventDefault();
          selectZero(event.currentTarget);
          onMouseUp?.(event);
        }}
        className={cn('flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm', className)}
        ref={setRefs}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
