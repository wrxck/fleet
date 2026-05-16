function findUnitSection(content: string): { start: number; end: number } {
  const lines = content.split('\n');
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '[Unit]') { start = i; continue; }
    if (start >= 0 && lines[i].startsWith('[') && lines[i].endsWith(']')) {
      end = i;
      break;
    }
  }
  if (start < 0) throw new Error('no [Unit] section found');
  if (end < 0) end = lines.length;
  return { start, end };
}

export function addAgentDependency(content: string, app: string): string {
  const lines = content.split('\n');
  const requires = `Requires=fleet-secrets-agent@${app}.service`;
  const after = `After=fleet-secrets-agent@${app}.service`;

  if (lines.includes(requires) && lines.includes(after)) return content;

  const section = findUnitSection(content);

  let insertAt = section.end;
  while (insertAt > section.start + 1 && lines[insertAt - 1].trim() === '') insertAt--;

  const toInsert: string[] = [];
  if (!lines.includes(requires)) toInsert.push(requires);
  if (!lines.includes(after)) toInsert.push(after);

  lines.splice(insertAt, 0, ...toInsert);
  return lines.join('\n');
}

export function removeAgentDependency(content: string, app: string): string {
  const requires = `Requires=fleet-secrets-agent@${app}.service`;
  const after = `After=fleet-secrets-agent@${app}.service`;
  return content
    .split('\n')
    .filter(l => l !== requires && l !== after)
    .join('\n');
}
