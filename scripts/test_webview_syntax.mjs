import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Starting Webview JavaScript Syntax & Runtime Initialization Verification...');

if (!fs.existsSync('media/sidebar.js')) {
  console.error('❌ Failed to locate media/sidebar.js');
  process.exit(1);
}

const js = fs.readFileSync('media/sidebar.js', 'utf8');

try {
  // 1. Syntax Check
  new vm.Script(js);
  console.log('✓ Webview JavaScript is 100% syntactically valid.');

  // 2. Runtime Simulation Check (mocking DOM and acquireVsCodeApi to ensure zero ReferenceErrors)
  const mockContext = {
    acquireVsCodeApi: () => ({
      postMessage: () => {},
      getState: () => ({}),
      setState: () => {}
    }),
    document: {
      getElementById: (id) => ({
        id,
        classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
        addEventListener: () => {},
        setAttribute: () => {},
        getAttribute: () => null,
        appendChild: () => {},
        style: {},
        value: '',
        textContent: '',
        innerHTML: ''
      }),
      querySelector: () => ({
        addEventListener: () => {}
      }),
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: (tag) => ({
        tagName: tag,
        classList: { add: () => {}, remove: () => {}, contains: () => false },
        addEventListener: () => {},
        appendChild: () => {},
        setAttribute: () => {},
        getAttribute: () => null,
        style: {},
        textContent: '',
        innerHTML: ''
      })
    },
    window: {
      addEventListener: () => {}
    },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    console: console
  };

  vm.createContext(mockContext);
  vm.runInContext(js, mockContext);
  console.log('✓ Webview JavaScript executed cleanly with zero ReferenceError / runtime initialization crashes!');
  console.log('\n🎉 ALL WEBVIEW SYNTAX & RUNTIME TESTS PASSED CLEANLY!\n');
} catch (err) {
  console.error('❌ Error detected in Webview JavaScript:', err);
  process.exit(1);
}
