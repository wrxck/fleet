import { z } from 'zod';

import {
  loadOperator, operatorPath, saveOperator,
  OPERATOR_FIELDS, type OperatorConfig, type OperatorField,
} from '../core/operator';
import { defineCommand } from '../registry/registry';
import type { CommandResult } from '../registry/types';

export interface ConfigData {
  action: 'show' | 'get' | 'set';
  path: string;
  config?: OperatorConfig;
  field?: OperatorField;
  value?: string;
}

function isOperatorField(name: string): name is OperatorField {
  return (OPERATOR_FIELDS as readonly string[]).includes(name);
}

export const configCommand = defineCommand({
  name: 'config',
  summary: 'Show or update the operator identity config (data/operator.json)',
  args: z.object({
    action: z.enum(['show', 'get', 'set']).default('show'),
    field: z.string().optional(),
    value: z.string().optional(),
  }),
  async run(args, _ctx): Promise<CommandResult<ConfigData>> {
    const path = operatorPath();

    if (args.action === 'show') {
      const cfg = loadOperator();
      return {
        ok: true,
        summary: `operator: ${cfg.username} @ ${cfg.domain} (github ${cfg.githubOrg})`,
        data: { action: 'show', path, config: cfg },
        render: {
          kind: 'keyValue',
          pairs: [
            ['path', path],
            ['username', cfg.username],
            ['homeDir', cfg.homeDir],
            ['domain', cfg.domain],
            ['githubOrg', cfg.githubOrg],
          ],
        },
      };
    }

    if (args.action === 'get') {
      if (!args.field) {
        return { ok: false, summary: 'fleet config get <field>', data: { action: 'get', path } };
      }
      if (!isOperatorField(args.field)) {
        return {
          ok: false,
          summary: `unknown field: ${args.field} (known: ${OPERATOR_FIELDS.join(', ')})`,
          data: { action: 'get', path },
        };
      }
      const cfg = loadOperator();
      const value = cfg[args.field];
      return {
        ok: true,
        summary: value,
        data: { action: 'get', path, field: args.field, value },
      };
    }

    // action === 'set'
    if (!args.field || !args.value) {
      return {
        ok: false,
        summary: 'fleet config set <field> <value>',
        data: { action: 'set', path },
      };
    }
    if (!isOperatorField(args.field)) {
      return {
        ok: false,
        summary: `unknown field: ${args.field} (known: ${OPERATOR_FIELDS.join(', ')})`,
        data: { action: 'set', path },
      };
    }
    const cfg = loadOperator();
    const next: OperatorConfig = { ...cfg, [args.field]: args.value };
    saveOperator(next);
    return {
      ok: true,
      summary: `set ${args.field}=${args.value}`,
      data: { action: 'set', path, field: args.field, value: args.value, config: next },
    };
  },
});

export interface WhoamiData {
  username: string;
  domain: string;
  githubOrg: string;
  homeDir: string;
}

export const whoamiCommand = defineCommand({
  name: 'whoami',
  summary: 'Print the operator identity in one line',
  args: z.object({}),
  async run(_args, _ctx): Promise<CommandResult<WhoamiData>> {
    const cfg = loadOperator();
    return {
      ok: true,
      summary: `${cfg.username} @ ${cfg.domain} (github ${cfg.githubOrg}, home ${cfg.homeDir})`,
      data: {
        username: cfg.username,
        domain: cfg.domain,
        githubOrg: cfg.githubOrg,
        homeDir: cfg.homeDir,
      },
    };
  },
});
