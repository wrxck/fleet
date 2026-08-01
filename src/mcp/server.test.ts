import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Port validation logic (extracted from server.ts for isolated testing) ---

const DANGEROUS_PORTS = [5432, 3306, 27017, 6379, 9000];

function validateNginxPort(port: number): string | null {
  if (port < 1024 || port > 65535) {
    return `Invalid port ${port}: must be in range 1024-65535`;
  }
  if (DANGEROUS_PORTS.includes(port)) {
    return `Port ${port} is not allowed (reserved for internal services)`;
  }
  return null;
}

describe('fleet_nginx_add port validation', () => {
  it('allows valid ports', () => {
    expect(validateNginxPort(3000)).toBeNull();
    expect(validateNginxPort(8080)).toBeNull();
    expect(validateNginxPort(4000)).toBeNull();
    expect(validateNginxPort(65535)).toBeNull();
    expect(validateNginxPort(1024)).toBeNull();
  });

  it('blocks port below 1024', () => {
    expect(validateNginxPort(80)).toMatch(/Invalid port/);
    expect(validateNginxPort(443)).toMatch(/Invalid port/);
    expect(validateNginxPort(22)).toMatch(/Invalid port/);
    expect(validateNginxPort(1023)).toMatch(/Invalid port/);
  });

  it('blocks port above 65535', () => {
    expect(validateNginxPort(65536)).toMatch(/Invalid port/);
    expect(validateNginxPort(99999)).toMatch(/Invalid port/);
  });

  it('blocks PostgreSQL port 5432', () => {
    expect(validateNginxPort(5432)).toMatch(/not allowed/);
  });

  it('blocks MySQL port 3306', () => {
    expect(validateNginxPort(3306)).toMatch(/not allowed/);
  });

  it('blocks MongoDB port 27017', () => {
    expect(validateNginxPort(27017)).toMatch(/not allowed/);
  });

  it('blocks Redis port 6379', () => {
    expect(validateNginxPort(6379)).toMatch(/not allowed/);
  });

  it('blocks MinIO port 9000', () => {
    expect(validateNginxPort(9000)).toMatch(/not allowed/);
  });

  it('blocklist covers all five internal service ports', () => {
    expect(DANGEROUS_PORTS).toHaveLength(5);
    expect(DANGEROUS_PORTS).toContain(5432);
    expect(DANGEROUS_PORTS).toContain(3306);
    expect(DANGEROUS_PORTS).toContain(27017);
    expect(DANGEROUS_PORTS).toContain(6379);
    expect(DANGEROUS_PORTS).toContain(9000);
  });
});

// --- MCP server tool registration ---
// Capture registered tool names via a mock McpServer

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
const capturedTools: string[] = [];
const capturedHandlers = new Map<string, ToolHandler>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class McpServer {
    tool(name: string, ...rest: unknown[]) {
      capturedTools.push(name);
      // the handler is always the last argument (shape is optional).
      const handler = rest[rest.length - 1];
      if (typeof handler === 'function') capturedHandlers.set(name, handler as ToolHandler);
    }
    connect = vi.fn().mockResolvedValue(undefined);
  }
  return { McpServer };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  class StdioServerTransport {}
  return { StdioServerTransport };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('{"name":"fleet","version":"0.0.0"}'),
  };
});

vi.mock('../core/registry.js', () => ({
  load: vi.fn().mockReturnValue({
    apps: [],
    infrastructure: { databases: { composePath: '/db' }, nginx: {} },
  }),
  findApp: vi.fn(),
  save: vi.fn(),
  addApp: vi.fn(),
}));
vi.mock('../core/systemd.js', () => ({
  startService: vi.fn(),
  stopService: vi.fn(),
  restartService: vi.fn(),
  restartServiceResult: vi.fn().mockReturnValue({ ok: true }),
}));
vi.mock('../core/docker.js', () => ({
  getContainerLogs: vi.fn(),
  getContainersByCompose: vi.fn().mockReturnValue([]),
  listContainers: vi.fn().mockReturnValue([]),
  composeBuild: vi.fn(),
  composeBuildResult: vi.fn().mockReturnValue({ ok: true }),
}));
vi.mock('../core/health.js', () => ({
  checkHealth: vi.fn(),
  checkAllHealth: vi.fn(),
}));
vi.mock('../core/nginx.js', () => ({
  listSites: vi.fn(),
  installConfig: vi.fn(),
  testConfig: vi.fn().mockReturnValue({ ok: true, output: '' }),
  reload: vi.fn(),
  removeConfig: vi.fn(),
}));
vi.mock('../templates/nginx.js', () => ({
  generateNginxConfig: vi.fn().mockReturnValue(''),
}));
vi.mock('../core/secrets.js', () => ({
  loadManifest: vi.fn().mockReturnValue({ apps: {} }),
  listSecrets: vi.fn().mockReturnValue([]),
  isInitialized: vi.fn().mockReturnValue(true),
}));
vi.mock('../core/secrets-ops.js', () => ({
  unsealAll: vi.fn(),
  getStatus: vi.fn().mockReturnValue({}),
}));
vi.mock('../core/secrets-validate.js', () => ({
  validateApp: vi.fn(),
  validateAll: vi.fn(),
}));
vi.mock('../commands/freeze.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../commands/freeze')>();
  return {
    ...actual,
    freezeApp: vi.fn(),
    unfreezeApp: vi.fn(),
  };
});
vi.mock('../core/onboarding.js', () => ({
  checkApp: vi.fn().mockResolvedValue({ app: 'demo', checks: [], ok: true }),
  summarizeUnresolved: vi.fn().mockReturnValue([]),
}));
vi.mock('../core/deploy-preflight.js', () => ({
  preflightDeploy: vi.fn().mockReturnValue({ ok: true, failures: [] }),
  formatPreflightFailures: vi.fn().mockReturnValue([]),
}));
vi.mock('../core/service-install.js', () => ({
  installServiceForApp: vi.fn().mockReturnValue({ ok: true, message: 'installed demo.service' }),
}));
vi.mock('./git-tools.js', () => ({
  registerGitTools: vi.fn(),
}));
vi.mock('./secrets-tools.js', () => ({
  registerSecretsTools: vi.fn(),
}));
vi.mock('./deps-tools.js', () => ({
  registerDepsTools: vi.fn(),
}));

import { startMcpServer } from './server';

describe('MCP server tool registration', () => {
  beforeEach(async () => {
    capturedTools.length = 0;
    await startMcpServer();
  });

  const EXPECTED_TOOLS = [
    'fleet_status',
    'fleet_list',
    'fleet_start',
    'fleet_stop',
    'fleet_restart',
    'fleet_logs',
    'fleet_health',
    'fleet_deploy',
    'fleet_nginx_add',
    'fleet_nginx_list',
    'fleet_secrets_status',
    'fleet_secrets_list',
    'fleet_secrets_unseal',
    'fleet_secrets_validate',
    'fleet_register',
    'fleet_onboard',
    'fleet_service_install',
    'fleet_freeze',
    'fleet_unfreeze',
    'fleet_rollback',
  ];

  for (const toolName of EXPECTED_TOOLS) {
    it(`registers tool: ${toolName}`, () => {
      expect(capturedTools).toContain(toolName);
    });
  }
});

describe('fleet_deploy surfaces the real reason', () => {
  beforeEach(async () => {
    capturedTools.length = 0;
    capturedHandlers.clear();
    await startMcpServer();
  });

  it('returns a clear "requires root" error to the caller when not root', async () => {
    const registry = await import('../core/registry.js');
    vi.mocked(registry.findApp).mockReturnValue({
      name: 'demo', serviceName: 'demo', composePath: '/srv/demo', composeFile: null,
      containers: ['demo'],
    } as unknown as ReturnType<typeof registry.findApp>);

    const getuid = process.getuid;
    // simulate a non-root caller (the stdio path runs as the user).
    process.getuid = () => 1000;
    try {
      const result = await capturedHandlers.get('fleet_deploy')!({ app: 'demo' }) as {
        isError?: boolean; content: Array<{ text: string }>;
      };
      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toMatch(/requires root/i);
    } finally {
      process.getuid = getuid;
    }
  });

  it('returns the preflight failures (with fix commands) instead of a bare build error', async () => {
    const registry = await import('../core/registry.js');
    vi.mocked(registry.findApp).mockReturnValue({
      name: 'demo', serviceName: 'demo', composePath: '/srv/demo', composeFile: null,
      containers: ['demo'],
    } as unknown as ReturnType<typeof registry.findApp>);

    const preflight = await import('../core/deploy-preflight.js');
    vi.mocked(preflight.preflightDeploy).mockReturnValue({
      ok: false,
      failures: [{
        id: 'runtime-env', title: 'Runtime env file', status: 'missing', blocking: true,
        detail: '/run/fleet-secrets/demo/.env does not exist',
        fix: { runner: 'mcp', command: 'fleet_secrets_unseal' },
      }],
    });
    vi.mocked(preflight.formatPreflightFailures).mockReturnValue([
      '  [runtime-env] /run/fleet-secrets/demo/.env does not exist\n    fix (mcp): fleet_secrets_unseal',
    ]);

    const getuid = process.getuid;
    process.getuid = () => 0;
    try {
      const result = await capturedHandlers.get('fleet_deploy')!({ app: 'demo' }) as {
        isError?: boolean; content: Array<{ text: string }>;
      };
      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toMatch(/Preflight failed/);
      expect(result.content[0].text).toMatch(/fleet_secrets_unseal/);
      const docker = await import('../core/docker.js');
      expect(vi.mocked(docker.composeBuildResult)).not.toHaveBeenCalled();
    } finally {
      process.getuid = getuid;
      vi.mocked(preflight.preflightDeploy).mockReturnValue({ ok: true, failures: [] });
      vi.mocked(preflight.formatPreflightFailures).mockReturnValue([]);
    }
  });
});

describe('fleet_onboard and fleet_service_install handlers', () => {
  beforeEach(async () => {
    capturedTools.length = 0;
    capturedHandlers.clear();
    await startMcpServer();
  });

  it('fleet_onboard returns the structured report as json', async () => {
    const onboarding = await import('../core/onboarding.js');
    vi.mocked(onboarding.checkApp).mockResolvedValue({
      app: 'demo',
      ok: false,
      checks: [{
        id: 'unit', title: 'Systemd unit', status: 'missing', blocking: true,
        detail: 'demo.service does not exist',
        fix: { runner: 'mcp', command: 'fleet_service_install { app: "demo" }' },
      }],
    });
    const result = await capturedHandlers.get('fleet_onboard')!({ app: 'demo' }) as {
      isError?: boolean; content: Array<{ text: string }>;
    };
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBeFalsy();
    expect(parsed.checks[0].fix.runner).toBe('mcp');
  });

  it('fleet_service_install surfaces a refusal as an error result', async () => {
    const serviceInstall = await import('../core/service-install.js');
    vi.mocked(serviceInstall.installServiceForApp).mockReturnValue({
      ok: false, message: 'demo.service already exists — pass force to overwrite it.',
    });
    const result = await capturedHandlers.get('fleet_service_install')!({ app: 'demo', force: false }) as {
      isError?: boolean; content: Array<{ text: string }>;
    };
    expect(result.isError).toBeTruthy();
    expect(result.content[0].text).toMatch(/already exists/);
    expect(vi.mocked(serviceInstall.installServiceForApp)).toHaveBeenCalledWith('demo', { force: false });
  });
});
