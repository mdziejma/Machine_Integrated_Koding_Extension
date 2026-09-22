import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const stagingDir = path.join(rootDir, 'dist_vsix');

// Read package.json for version & metadata
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const outVsix = path.join(rootDir, `${pkg.name}-${pkg.version}.vsix`);

// 1. Clean staging directory
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
if (fs.existsSync(outVsix)) {
  fs.unlinkSync(outVsix);
}

fs.mkdirSync(stagingDir, { recursive: true });

// 3. Create [Content_Types].xml
const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="txt" ContentType="text/plain"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
</Types>`;
fs.writeFileSync(path.join(stagingDir, '[Content_Types].xml'), contentTypesXml, 'utf8');

// 4. Create extension.vsixmanifest
const iconMetadata = pkg.icon ? `\n\t\t<Icon>extension/${pkg.icon}</Icon>` : '';
const iconAsset = pkg.icon ? `\n\t\t<Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${pkg.icon}" Addressable="true" />` : '';

const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
	<Metadata>
		<Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />
		<DisplayName>${pkg.displayName}</DisplayName>
		<Description xml:space="preserve">${pkg.description}</Description>
		<Tags></Tags>
		<Categories>${pkg.categories ? pkg.categories.join(',') : 'AI'}</Categories>
		<GalleryFlags>Public</GalleryFlags>
		<Properties>
			<Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines?.vscode || '^1.85.0'}" />
			<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
			<Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
			<Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
			<Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/>
		</Properties>
		<License>extension/LICENSE</License>${iconMetadata}
	</Metadata>
	<Installation>
		<InstallationTarget Id="Microsoft.VisualStudio.Code"/>
	</Installation>
	<Dependencies/>
	<Assets>
		<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
		<Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />${iconAsset}
	</Assets>
</PackageManifest>`;
fs.writeFileSync(path.join(stagingDir, 'extension.vsixmanifest'), vsixManifest, 'utf8');

// 5. Copy extension directory contents
const extDir = path.join(stagingDir, 'extension');
fs.mkdirSync(extDir, { recursive: true });

// Copy package.json
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(extDir, 'package.json'));

// Copy LICENSE if exists
if (fs.existsSync(path.join(rootDir, 'LICENSE'))) {
  fs.copyFileSync(path.join(rootDir, 'LICENSE'), path.join(extDir, 'LICENSE'));
}

// Copy docs/README.md as README.md
if (fs.existsSync(path.join(rootDir, 'docs/README.md'))) {
  fs.copyFileSync(path.join(rootDir, 'docs/README.md'), path.join(extDir, 'README.md'));
}

// Copy directories recursively
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (!entry.name.endsWith('.map') && !entry.name.endsWith('.tsbuildinfo')) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(path.join(rootDir, 'out'))) {
  copyDirRecursive(path.join(rootDir, 'out'), path.join(extDir, 'out'));
}

if (fs.existsSync(path.join(rootDir, 'docs'))) {
  copyDirRecursive(path.join(rootDir, 'docs'), path.join(extDir, 'docs'));
}

if (fs.existsSync(path.join(rootDir, 'media'))) {
  copyDirRecursive(path.join(rootDir, 'media'), path.join(extDir, 'media'));
}

if (fs.existsSync(path.join(rootDir, '.agent'))) {
  copyDirRecursive(path.join(rootDir, '.agent'), path.join(extDir, '.agent'));
}

// 6. Zip into VSIX using zip command
execSync(`cd "${stagingDir}" && zip -q -r "${outVsix}" .`, { stdio: 'inherit' });

// 7. Cleanup staging directory
fs.rmSync(stagingDir, { recursive: true, force: true });

console.log(`\n🎉 Successfully packaged M.I.K.E. v${pkg.version} into:\n   ${outVsix}\n`);
