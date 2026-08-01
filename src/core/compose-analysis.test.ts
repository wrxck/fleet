import { describe, it, expect, afterEach } from 'vitest';

import { analyzeCompose, deployBlockingVars, resolveComposeFile } from './compose-analysis';

describe('analyzeCompose — env var classification', () => {
  it('classifies strict, bare and defaulted interpolations', () => {
    const a = analyzeCompose([
      'services:',
      '  web:',
      '    image: nginx',
      '    environment:',
      '      - API_KEY=${API_KEY:?required}',
      '      - MODE=${MODE}',
      '      - LOG_LEVEL=${LOG_LEVEL:-info}',
      '      - REGION=${REGION-eu}',
      '',
    ].join('\n'));
    expect(a.strictRequiredVars).toEqual(['API_KEY']);
    expect(a.bareVars).toEqual(['MODE']);
    expect(a.defaultedVars).toEqual(['LOG_LEVEL', 'REGION']);
    expect(a.requiredVars).toEqual(['API_KEY', 'MODE']);
  });

  it('treats the ${VAR?msg} form as strict and $VAR shorthand as bare', () => {
    const a = analyzeCompose('services:\n  w:\n    command: run ${TOKEN?needed} $HOST\n');
    expect(a.strictRequiredVars).toEqual(['TOKEN']);
    expect(a.bareVars).toEqual(['HOST']);
  });

  it('gives strict precedence when a var appears in several forms', () => {
    const a = analyzeCompose('x: ${FOO:-d}\ny: ${FOO}\nz: ${FOO:?msg}\n');
    expect(a.strictRequiredVars).toEqual(['FOO']);
    expect(a.bareVars).toEqual([]);
    expect(a.defaultedVars).toEqual([]);
  });

  it('ignores $$-escaped dollars', () => {
    const a = analyzeCompose('services:\n  w:\n    command: echo $$NOT_A_VAR ${REAL}\n');
    expect(a.bareVars).toEqual(['REAL']);
  });

  it('does not classify :+ alternates as required', () => {
    const a = analyzeCompose('x: ${OPT:+set}\n');
    expect(a.requiredVars).toEqual([]);
    expect(a.defaultedVars).toEqual(['OPT']);
  });
});

describe('analyzeCompose — build args', () => {
  it('extracts env-referencing build args from the list form', () => {
    const a = analyzeCompose([
      'services:',
      '  api:',
      '    build:',
      '      context: .',
      '      args:',
      '        - NPM_TOKEN=${NPM_TOKEN}',
      '        - STATIC=fixed-value',
      '        - PASSTHROUGH',
      '',
    ].join('\n'));
    expect(a.buildArgVars).toEqual(['NPM_TOKEN', 'PASSTHROUGH']);
  });

  it('extracts env-referencing build args from the map form', () => {
    const a = analyzeCompose([
      'services:',
      '  api:',
      '    build:',
      '      context: .',
      '      args:',
      '        NPM_TOKEN: ${NPM_TOKEN}',
      '        FROM_ENV: null',
      '        FIXED: value',
      '',
    ].join('\n'));
    expect(a.buildArgVars).toEqual(['FROM_ENV', 'NPM_TOKEN']);
  });

  it('excludes defaulted build args — they have a fallback', () => {
    const a = analyzeCompose([
      'services:',
      '  api:',
      '    build:',
      '      args:',
      '        - NODE_ENV=${NODE_ENV:-production}',
      '',
    ].join('\n'));
    expect(a.buildArgVars).toEqual([]);
  });
});

describe('analyzeCompose — project name and host ports', () => {
  it('extracts the explicit top-level name and published host ports', () => {
    const a = analyzeCompose([
      'name: myproj',
      'services:',
      '  web:',
      '    ports:',
      '      - "3007:3000"',
      '      - "127.0.0.1:9090:9090"',
      '      - "8443:443/udp"',
      '      - "80"',
      '  admin:',
      '    ports:',
      '      - target: 8080',
      '        published: 8081',
      '',
    ].join('\n'));
    expect(a.projectName).toBe('myproj');
    expect(a.hostPorts.sort()).toEqual([3007, 8081, 8443, 9090].sort());
  });

  it('reports null when no explicit project name exists', () => {
    const a = analyzeCompose('services:\n  web:\n    image: nginx\n');
    expect(a.projectName).toBeNull();
  });

  it('flags a yaml parse failure but still scans vars from the raw text', () => {
    const a = analyzeCompose('services:\n  web:\n   bad: [unclosed\n    x: ${NEEDED:?y}\n');
    expect(a.yamlParseFailed).toBeTruthy();
    expect(a.strictRequiredVars).toEqual(['NEEDED']);
  });
});

describe('deployBlockingVars', () => {
  afterEach(() => {
    delete process.env.CA_TEST_SUPPLIED;
  });

  it('includes strict and build-arg vars but not bare or defaulted ones', () => {
    const a = analyzeCompose([
      'services:',
      '  api:',
      '    build:',
      '      args:',
      '        - NPM_TOKEN=${NPM_TOKEN}',
      '    environment:',
      '      - STRICT=${STRICT:?x}',
      '      - BARE=${BARE}',
      '      - SOFT=${SOFT:-1}',
      '',
    ].join('\n'));
    expect(deployBlockingVars(a)).toEqual(['NPM_TOKEN', 'STRICT']);
  });

  it('drops vars already supplied by the process environment', () => {
    process.env.CA_TEST_SUPPLIED = 'yes';
    const a = analyzeCompose('x: ${CA_TEST_SUPPLIED:?required}\n');
    expect(deployBlockingVars(a)).toEqual([]);
  });
});

describe('resolveComposeFile', () => {
  it('joins an explicit composeFile onto the composePath', () => {
    expect(resolveComposeFile({ composePath: '/srv/app', composeFile: 'docker-compose.staging.yml' }))
      .toBe('/srv/app/docker-compose.staging.yml');
  });

  it('falls back to docker-compose.yml when nothing exists yet', () => {
    expect(resolveComposeFile({ composePath: '/nonexistent-dir-for-test', composeFile: null }))
      .toBe('/nonexistent-dir-for-test/docker-compose.yml');
  });
});
