import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ToastProvider, ToastContext } from '../src/context.js';
import { ToastContainer } from '../src/toast-container.js';
import { useToast } from '../src/use-toast.js';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ToastTrigger({ message, type, duration }: {
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}): React.JSX.Element {
  const { toast } = useToast();
  React.useEffect(() => {
    toast(message, type, duration);
  }, []);
  return <Text>trigger</Text>;
}

describe('ink-toast', () => {
  it('renders a toast message', async () => {
    const { lastFrame } = render(
      <ToastProvider>
        <ToastTrigger message="hello world" type="info" />
        <ToastContainer />
      </ToastProvider>
    );
    await delay(50);
    expect(lastFrame()).toContain('hello world');
  });

  it('auto-dismisses after duration', async () => {
    vi.useFakeTimers();

    const { lastFrame } = render(
      <ToastProvider>
        <ToastTrigger message="vanish" type="info" duration={1000} />
        <ToastContainer />
      </ToastProvider>
    );

    await vi.advanceTimersByTimeAsync(50);
    expect(lastFrame()).toContain('vanish');

    await vi.advanceTimersByTimeAsync(1100);
    expect(lastFrame()).not.toContain('vanish');

    vi.useRealTimers();
  });

  it('shows correct icon for each type', async () => {
    function MultiToast(): React.JSX.Element {
      const { toast } = useToast();
      React.useEffect(() => {
        toast('ok', 'success');
        toast('fail', 'error');
        toast('note', 'info');
        toast('warn', 'warning');
      }, []);
      return <Text>multi</Text>;
    }

    const { lastFrame } = render(
      <ToastProvider maxToasts={4}>
        <MultiToast />
        <ToastContainer />
      </ToastProvider>
    );

    await delay(50);
    const frame = lastFrame()!;
    expect(frame).toContain('\u2713 ok');
    expect(frame).toContain('\u2717 fail');
    expect(frame).toContain('\u2139 note');
    expect(frame).toContain('\u26A0 warn');
  });

  it('limits visible toasts to maxToasts', async () => {
    function ManyToasts(): React.JSX.Element {
      const { toast } = useToast();
      React.useEffect(() => {
        toast('first', 'info');
        toast('second', 'info');
        toast('third', 'info');
        toast('fourth', 'info');
      }, []);
      return <Text>many</Text>;
    }

    const { lastFrame } = render(
      <ToastProvider maxToasts={2}>
        <ManyToasts />
        <ToastContainer />
      </ToastProvider>
    );

    await delay(50);
    const frame = lastFrame()!;
    expect(frame).not.toContain('first');
    expect(frame).not.toContain('second');
    expect(frame).toContain('third');
    expect(frame).toContain('fourth');
  });

  it('removeToast removes immediately', async () => {
    let removeRef: ((id: string) => void) | null = null;
    let toastIdRef: string | null = null;

    function RemoveTrigger(): React.JSX.Element {
      const ctx = React.useContext(ToastContext);
      if (ctx) {
        removeRef = ctx.removeToast;
      }
      React.useEffect(() => {
        if (!ctx) return;
        ctx.addToast('removable', 'info', 60000);
      }, []);
      return <Text>remove-trigger</Text>;
    }

    function IdCapture(): React.JSX.Element {
      const ctx = React.useContext(ToastContext);
      if (ctx && ctx.toasts.length > 0) {
        toastIdRef = ctx.toasts[0]!.id;
      }
      return <Text></Text>;
    }

    const { lastFrame } = render(
      <ToastProvider>
        <RemoveTrigger />
        <IdCapture />
        <ToastContainer />
      </ToastProvider>
    );

    await delay(50);
    expect(lastFrame()).toContain('removable');

    removeRef!(toastIdRef!);
    await delay(50);
    expect(lastFrame()).not.toContain('removable');
  });
});
