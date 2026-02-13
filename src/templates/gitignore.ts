import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ProjectType = 'node' | 'nextjs' | 'go' | 'php' | 'generic';

export function detectProjectType(dir: string): ProjectType {
  if (existsSync(join(dir, 'next.config.js')) || existsSync(join(dir, 'next.config.mjs')) || existsSync(join(dir, 'next.config.ts'))) {
    return 'nextjs';
  }
  if (existsSync(join(dir, 'package.json'))) return 'node';
  if (existsSync(join(dir, 'go.mod'))) return 'go';
  if (existsSync(join(dir, 'composer.json'))) return 'php';
  return 'generic';
}

const COMMON = `# ===== SECRETS - NEVER COMMIT =====
.env
.env.*
!.env.example
*.pem
*.key

# OS / editors
.DS_Store
Thumbs.db
.vscode/
.idea/
*.swp
*.swo
*~

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Docker overrides
docker-compose.override.yml
`;

const NODE = `# Node
node_modules/
dist/
build/
coverage/
.npm
`;

const NEXTJS = `# Node
node_modules/
dist/
build/
coverage/
.npm

# Next.js
.next/
out/
*.tsbuildinfo
`;

const GO = `# Go
bin/
vendor/
*.exe
`;

const PHP = `# PHP
/vendor/
composer.phar
`;

const FOOTER = `
# ===== REMINDER: check for secrets before committing =====
`;

export function generateGitignore(type: ProjectType): string {
  let content = COMMON;
  switch (type) {
    case 'nextjs': content += NEXTJS; break;
    case 'node': content += NODE; break;
    case 'go': content += GO; break;
    case 'php': content += PHP; break;
    case 'generic': break;
  }
  return content + FOOTER;
}
