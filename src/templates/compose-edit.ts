import { parseDocument, YAMLMap, YAMLSeq, isMap, isSeq, isScalar } from 'yaml';

const FLEET_ENV_KEY = 'FLEET_SECRETS_SOCKET';
const FLEET_ENV_VAL = '/run/fleet.sock';

function v1EnvFile(app: string): string {
  return `/run/fleet-secrets/${app}/.env`;
}

function v2SocketMount(app: string): string {
  return `/run/fleet-secrets/${app}.sock:/run/fleet.sock:ro`;
}

function getService(doc: ReturnType<typeof parseDocument>, service: string): YAMLMap {
  const svc = doc.getIn(['services', service], true);
  if (!svc || !isMap(svc)) {
    throw new Error(`service '${service}' not found in compose file`);
  }
  return svc as YAMLMap;
}

function removeEnvFileEntry(svc: YAMLMap, app: string): void {
  const v1Path = v1EnvFile(app);
  const raw = svc.get('env_file', true);
  if (raw === undefined || raw === null) return;

  if (isScalar(raw)) {
    if (raw.value === v1Path) {
      svc.delete('env_file');
    }
    return;
  }

  if (isSeq(raw)) {
    const seq = raw as YAMLSeq;
    const idx = seq.items.findIndex(item => isScalar(item) && item.value === v1Path);
    if (idx !== -1) {
      seq.items.splice(idx, 1);
    }
    if (seq.items.length === 0) {
      svc.delete('env_file');
    }
    return;
  }

  if (typeof raw === 'string' && raw === v1Path) {
    svc.delete('env_file');
  }
}

function ensureEnvVar(svc: YAMLMap): void {
  const envRaw = svc.get('environment', true);

  if (!envRaw) {
    svc.set('environment', { [FLEET_ENV_KEY]: FLEET_ENV_VAL });
    return;
  }

  if (isMap(envRaw)) {
    const env = envRaw as YAMLMap;
    if (!env.has(FLEET_ENV_KEY)) {
      env.set(FLEET_ENV_KEY, FLEET_ENV_VAL);
    }
    return;
  }

  if (isSeq(envRaw)) {
    const seq = envRaw as YAMLSeq;
    const kvPrefix = `${FLEET_ENV_KEY}=`;
    const already = seq.items.some(item => isScalar(item) && typeof item.value === 'string' && item.value.startsWith(kvPrefix));
    if (!already) {
      seq.add(`${FLEET_ENV_KEY}=${FLEET_ENV_VAL}`);
    }
    return;
  }
}

function removeEnvVar(svc: YAMLMap): void {
  const envRaw = svc.get('environment', true);
  if (!envRaw) return;

  if (isMap(envRaw)) {
    const env = envRaw as YAMLMap;
    env.delete(FLEET_ENV_KEY);
    if (env.items.length === 0) {
      svc.delete('environment');
    }
    return;
  }

  if (isSeq(envRaw)) {
    const seq = envRaw as YAMLSeq;
    const kvPrefix = `${FLEET_ENV_KEY}=`;
    const idx = seq.items.findIndex(item => isScalar(item) && typeof item.value === 'string' && item.value.startsWith(kvPrefix));
    if (idx !== -1) {
      seq.items.splice(idx, 1);
    }
    if (seq.items.length === 0) {
      svc.delete('environment');
    }
  }
}

function ensureSocketMount(svc: YAMLMap, app: string): void {
  const mount = v2SocketMount(app);
  const volRaw = svc.get('volumes', true);

  if (!volRaw) {
    svc.set('volumes', [mount]);
    return;
  }

  if (isSeq(volRaw)) {
    const seq = volRaw as YAMLSeq;
    const already = seq.items.some(item => isScalar(item) && item.value === mount);
    if (!already) {
      seq.add(mount);
    }
    return;
  }
}

function removeSocketMount(svc: YAMLMap, app: string): void {
  const mount = v2SocketMount(app);
  const volRaw = svc.get('volumes', true);
  if (!volRaw || !isSeq(volRaw)) return;

  const seq = volRaw as YAMLSeq;
  const idx = seq.items.findIndex(item => isScalar(item) && item.value === mount);
  if (idx !== -1) {
    seq.items.splice(idx, 1);
  }
  if (seq.items.length === 0) {
    svc.delete('volumes');
  }
}

function restoreEnvFile(svc: YAMLMap, app: string): void {
  const v1Path = v1EnvFile(app);
  const raw = svc.get('env_file', true);

  if (!raw) {
    svc.set('env_file', v1Path);
    return;
  }

  if (isScalar(raw)) {
    if (raw.value !== v1Path) {
      svc.set('env_file', v1Path);
    }
    return;
  }

  if (isSeq(raw)) {
    const seq = raw as YAMLSeq;
    const already = seq.items.some(item => isScalar(item) && item.value === v1Path);
    if (!already) {
      seq.items.unshift(seq.createNode(v1Path));
    }
  }
}

export function migrateComposeToV2(yamlContent: string, app: string, service: string): string {
  const doc = parseDocument(yamlContent);
  const svc = getService(doc, service);

  removeEnvFileEntry(svc, app);
  ensureEnvVar(svc);
  ensureSocketMount(svc, app);

  return doc.toString();
}

export function revertComposeFromV2(yamlContent: string, app: string, service: string): string {
  const doc = parseDocument(yamlContent);
  const svc = getService(doc, service);

  removeSocketMount(svc, app);
  removeEnvVar(svc);
  restoreEnvFile(svc, app);

  return doc.toString();
}
