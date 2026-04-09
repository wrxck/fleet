import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export type StepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'rolling-back';

export interface PipelineStep {
  label: string;
  status: StepStatus;
  progress?: number;
  duration?: number;
  output?: string;
}

export interface PipelineProps {
  steps: PipelineStep[];
  title?: string;
  showDuration?: boolean;
  showProgress?: boolean;
  compact?: boolean;
}

const indicators: Record<StepStatus, string> = {
  pending: '\u25CB',
  running: '',
  success: '\u2713',
  error: '\u2717',
  skipped: '\u2013',
  'rolling-back': '\u21BA',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ProgressBar({ progress }: { progress: number }): React.JSX.Element {
  const width = 8;
  const filled = Math.round(progress * width);
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  const pct = Math.round(progress * 100);
  return <Text>[{bar}] {pct}%</Text>;
}

function StatusIndicator({ status }: { status: StepStatus }): React.JSX.Element {
  switch (status) {
    case 'pending':
      return <Text dimColor>{indicators.pending}</Text>;
    case 'running':
      return <Text color="cyan"><Spinner type="dots" /></Text>;
    case 'success':
      return <Text color="green">{indicators.success}</Text>;
    case 'error':
      return <Text color="red">{indicators.error}</Text>;
    case 'skipped':
      return <Text dimColor>{indicators.skipped}</Text>;
    case 'rolling-back':
      return <Text color="yellow">{indicators['rolling-back']}</Text>;
  }
}

export function Pipeline({
  steps,
  title,
  showDuration = true,
  showProgress = true,
  compact = false,
}: PipelineProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {title && (
        <Text bold>{title}</Text>
      )}
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;

        return (
          <Box key={index} flexDirection="column">
            <Box>
              <StatusIndicator status={step.status} />
              <Text>{' '}</Text>
              <Text bold={step.status === 'running'} color={step.status === 'rolling-back' ? 'yellow' : undefined}>
                {step.label}
              </Text>
              {showDuration && step.duration != null && (
                <Text dimColor>{' '}({formatDuration(step.duration)})</Text>
              )}
              {showProgress && step.status === 'running' && step.progress != null && (
                <Box marginLeft={1}>
                  <ProgressBar progress={step.progress} />
                </Box>
              )}
            </Box>
            {!compact && step.output && (
              <Text dimColor>{'  '}{step.output}</Text>
            )}
            {!compact && !isLast && (
              <Text dimColor>{' \u2502'}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
