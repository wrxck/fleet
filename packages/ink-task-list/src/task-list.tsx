import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export type TaskStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface Task {
  label: string;
  status: TaskStatus;
  output?: string;
}

export interface TaskListProps {
  tasks: Task[];
  showOutput?: boolean;
}

const indicators: Record<TaskStatus, string> = {
  pending: '\u25CB',
  running: '',
  success: '\u2713',
  error: '\u2717',
  skipped: '\u2013',
};

function StatusIndicator({ status }: { status: TaskStatus }): React.JSX.Element {
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
  }
}

export function TaskList({ tasks, showOutput = true }: TaskListProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {tasks.map((task, index) => (
        <Box key={index} flexDirection="column">
          <Box>
            <StatusIndicator status={task.status} />
            <Text>{' '}</Text>
            <Text bold={task.status === 'running'}>{task.label}</Text>
          </Box>
          {showOutput && task.output && (
            <Text dimColor>{'  '}{task.output}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
