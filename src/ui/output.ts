import { writeSync } from 'node:fs';

const ESC = '\x1b[';

export const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,
};

export const icon = {
  ok: `${c.green}*${c.reset}`,
  warn: `${c.yellow}!${c.reset}`,
  err: `${c.red}x${c.reset}`,
  info: `${c.blue}-${c.reset}`,
  arrow: `${c.cyan}>${c.reset}`,
};

function write(fd: number, text: string): void {
  writeSync(fd, text + '\n');
}

export function heading(text: string): void {
  write(1, `\n${c.bold}${c.cyan}${text}${c.reset}`);
}

export function success(text: string): void {
  write(1, `${icon.ok} ${text}`);
}

export function warn(text: string): void {
  write(1, `${icon.warn} ${c.yellow}${text}${c.reset}`);
}

export function error(text: string): void {
  write(2, `${icon.err} ${c.red}${text}${c.reset}`);
}

export function info(text: string): void {
  write(1, `${icon.info} ${text}`);
}

export function dim(text: string): string {
  return `${c.dim}${text}${c.reset}`;
}

export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => stripAnsi(r[i] ?? '').length))
  );

  const header = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  const sep = widths.map(w => '-'.repeat(w)).join('--');

  write(1, `  ${c.bold}${header}${c.reset}`);
  write(1, `  ${c.dim}${sep}${c.reset}`);

  for (const row of rows) {
    const line = row.map((cell, i) => {
      const stripped = stripAnsi(cell);
      const pad = widths[i] - stripped.length;
      return cell + ' '.repeat(Math.max(0, pad));
    }).join('  ');
    write(1, `  ${line}`);
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
