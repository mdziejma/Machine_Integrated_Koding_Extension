import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Starting Webview JavaScript Syntax Verification...');

const content = fs.readFileSync('src/webview/sidebarProvider.ts', 'utf8');
const startTag = '<script nonce="${nonce}">';
const endTag = '</script>';
const startIndex = content.indexOf(startTag);
const endIndex = content.indexOf(endTag, startIndex);

if (startIndex === -1 || endIndex === -1) {
  console.error('❌ Failed to locate <script> block in src/webview/sidebarProvider.ts');
  process.exit(1);
}

const js = content.slice(startIndex + startTag.length, endIndex);

try {
  new vm.Script(js);
  console.log('✓ Webview JavaScript is 100% syntactically valid with zero runtime parsing errors!');
  console.log('\n🎉 ALL WEBVIEW SYNTAX TESTS PASSED CLEANLY!\n');
} catch (err) {
  console.error('❌ Syntax error detected in Webview JavaScript:', err);
  process.exit(1);
}
