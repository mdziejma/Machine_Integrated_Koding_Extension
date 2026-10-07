import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const vsixFile = path.join(rootDir, `${pkg.name}-${pkg.version}.vsix`);

async function promptToken() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`🔑 Enter Open VSX Personal Access Token (PAT) for publishing v${pkg.version}: `, (token) => {
      rl.close();
      resolve(token.trim());
    });
  });
}

async function main() {
  console.log(`\n🌐 Preparing to publish ${pkg.name} v${pkg.version} to Open VSX Registry...\n`);

  // Ensure current version VSIX exists
  if (!fs.existsSync(vsixFile)) {
    console.log(`📦 VSIX for v${pkg.version} not found. Packaging now...`);
    execSync('npm run package', { stdio: 'inherit' });
  }

  let token = process.env.OVSX_PAT || process.argv[2];

  if (!token) {
    token = await promptToken();
  }

  if (!token) {
    console.error('❌ Error: Open VSX PAT token is required to publish.');
    process.exit(1);
  }

  console.log(`🚀 Publishing ${path.basename(vsixFile)} to Open VSX...`);
  try {
    execSync(`npx -y ovsx publish "${vsixFile}" -p "${token}"`, { stdio: 'inherit' });
    console.log(`\n🎉 Successfully published ${pkg.name} v${pkg.version} to Open VSX Registry!\n`);
  } catch (err) {
    console.error(`\n❌ Failed to publish to Open VSX Registry.`);
    process.exit(1);
  }
}

main();
