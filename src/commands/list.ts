import { z } from 'zod';

import { load } from '../core/registry';
import type { AppEntry } from '../core/registry';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export const listCommand = defineCommand({
  name: 'list',
  summary: 'List registered apps',
  args: z.object({}),
  async run(): Promise<CommandResult<AppEntry[]>> {
    const reg = load();
    return {
      ok: true,
      summary: `${reg.apps.length} app${reg.apps.length === 1 ? '' : 's'} registered`,
      data: reg.apps,
      render: {
        kind: 'table',
        columns: ['NAME', 'SERVICE', 'PORT', 'TYPE', 'DOMAINS'],
        rows: reg.apps.map(a => [
          a.name, a.serviceName, a.port?.toString() ?? '—', a.type, a.domains.join(', ') || '—',
        ]),
      },
    };
  },
});
