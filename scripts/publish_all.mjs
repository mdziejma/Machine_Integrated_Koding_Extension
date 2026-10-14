import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const vsixFile = path.join(rootDir, `${pkg.name}-${pkg.version}.vsix`);

function loadEnvToken(keyName) {
  if (process.env[keyName]) return process.env[keyName].trim();
  const envPaths = [
    path.join(rootDir, '.env'),
    path.join(os.homedir(), '.env')
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(new RegExp(`^\\s*(?:export\\s+)?${keyName}\\s*=\\s*(.+)\\s*$`));
        if (match) {
          return match[1].trim().replace(/^['"]|['"]$/g, '');
        }
      }
    }
  }
  return '';
}

function promptQuestion(questionText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(questionText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log(`\n🚀 Dual-Publishing ${pkg.name} v${pkg.version} (Open VSX + Microsoft Marketplace)...\n`);

  console.log(`📦 Building fresh VSIX package for v${pkg.version}...`);
  execSync('npm run package', { stdio: 'inherit' });

  if (!fs.existsSync(vsixFile)) {
    console.error(`❌ Error: Expected VSIX file not found at ${vsixFile}`);
    process.exit(1);
  }

  let ovsxToken = loadEnvToken('OVSX_PAT');
  if (!ovsxToken) {
    ovsxToken = await promptQuestion(`🔑 Enter Open VSX PAT for v${pkg.version} (or press Enter to skip Open VSX): `);
  }

  let vsceToken = loadEnvToken('VSCE_PAT');
  if (!vsceToken) {
    vsceToken = await promptQuestion(`🔑 Enter Microsoft Marketplace PAT (VSCE_PAT) for v${pkg.version} (or press Enter to skip MS Marketplace): `);
  }

  if (!ovsxToken && !vsceToken) {
    console.error('❌ No tokens provided. Nothing was published.');
    process.exit(1);
  }

  let hasErrors = false;

  const ovsxBin = fs.existsSync('/Users/mdzie/GitHub/Minimal_Intelligent_Kuota_Extension/node_modules/.bin/ovsx')
    ? '"/Users/mdzie/GitHub/Minimal_Intelligent_Kuota_Extension/node_modules/.bin/ovsx"'
    : 'npx -y ovsx';
  const vsceBin = fs.existsSync('/Users/mdzie/GitHub/Minimal_Intelligent_Kuota_Extension/node_modules/.bin/vsce')
    ? '"/Users/mdzie/GitHub/Minimal_Intelligent_Kuota_Extension/node_modules/.bin/vsce"'
    : 'npx -y @vscode/vsce';

  if (ovsxToken) {
    console.log(`\n🌐 [1/2] Publishing ${path.basename(vsixFile)} to Open VSX Registry...`);
    try {
      execSync(`${ovsxBin} publish "${vsixFile}" -p "${ovsxToken}"`, { stdio: 'inherit' });
      console.log(`✅ Open VSX publish succeeded!`);
    } catch (err) {
      console.error(`❌ Open VSX publish failed.`);
      hasErrors = true;
    }
  }

  if (vsceToken) {
    console.log(`\n🛍️  [2/2] Publishing ${path.basename(vsixFile)} to Microsoft VS Code Marketplace...`);
    try {
      execSync(`${vsceBin} publish --packagePath "${vsixFile}" -p "${vsceToken}"`, { stdio: 'inherit' });
      console.log(`✅ Microsoft Marketplace publish succeeded!`);
    } catch (err) {
      console.error(`❌ Microsoft Marketplace publish failed.`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log(`\n🎉 Dual-publishing complete for ${pkg.name} v${pkg.version}!\n`);
}

main();
