import type { Key } from 'ink';

/**
 * Return true to indicate the input was consumed (stop further processing).
 * Return false/void to let it fall through to the next handler.
 */
export type InputHandler = (input: string, key: Key) => boolean | void;
