import assert from 'node:assert';
import Module from 'node:module';

// Mock 'vscode' module for standalone Node test environment
const mockVscode = {
  workspace: {
    getConfiguration: () => ({
      get: () => undefined,
      update: async () => {}
    }),
    asRelativePath: (p) => (typeof p === 'string' ? p : p?.fsPath || ''),
    fs: {
      readFile: async () => new Uint8Array(),
      writeFile: async () => {},
      delete: async () => {}
    }
  },
  window: {
    showInformationMessage: async () => {},
    showErrorMessage: async () => {},
    showWarningMessage: async () => {},
    showInputBox: async () => '',
    showQuickPick: async () => undefined,
    createTextEditorDecorationType: () => ({ dispose: () => {} }),
    withProgress: async (_opts, task) => task({ report: () => {} }, { onCancellationRequested: () => {} })
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: async () => {}
  },
  languages: {
    getDiagnostics: () => []
  },
  EventEmitter: class {
    constructor() {
      this.event = (listener) => ({ dispose: () => {} });
    }
    fire() {}
    dispose() {}
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  ProgressLocation: { Notification: 15 },
  OverviewRulerLane: { Right: 4 },
  Range: class {
    constructor(start, end) { this.start = start; this.end = end; }
  },
  Position: class {
    constructor(line, character) { this.line = line; this.character = character; }
  },
  Uri: {
    file: (p) => ({ fsPath: p, path: p, scheme: 'file' }),
    parse: (p) => ({ fsPath: p, path: p, scheme: 'file' })
  }
};

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return mockVscode;
  }
  return origRequire.apply(this, arguments);
};

// Dynamic import of AgentClient
const { AgentClient } = await import('../out/agent/client.js');

console.log('🧪 Starting Inline Transform Test Suite...');

// 1. Test cleanTransformedCode with different fence styles
const rawWithFences = '```typescript\nexport function test(): number {\n  return 42;\n}\n```';
const cleaned1 = AgentClient.cleanTransformedCode(rawWithFences);
assert.strictEqual(cleaned1, 'export function test(): number {\n  return 42;\n}');
console.log('✓ Markdown code fence stripping verified.');

const rawWithNoLang = '```\nconst a = 10;\n```';
const cleaned2 = AgentClient.cleanTransformedCode(rawWithNoLang);
assert.strictEqual(cleaned2, 'const a = 10;');
console.log('✓ Generic code fence stripping verified.');

const rawPlain = 'function simple() { return true; }';
const cleaned3 = AgentClient.cleanTransformedCode(rawPlain);
assert.strictEqual(cleaned3, 'function simple() { return true; }');
console.log('✓ Plain text passthrough verified.');

// 2. Test SSE Streaming Response with mocked fetch
class MockMemento {
  constructor() { this.m = new Map(); }
  get(k, d) { return this.m.has(k) ? this.m.get(k) : d; }
  async update(k, v) { this.m.set(k, v); }
}
class MockSecretStorage {
  constructor() { this.s = new Map(); }
  async get(k) { return this.s.get(k); }
  async store(k, v) { this.s.set(k, v); }
  async delete(k) { this.s.delete(k); }
}

AgentClient.initializePersistence(new MockSecretStorage(), new MockMemento());
await AgentClient.savePersistentConfig({
  baseUrl: 'http://localhost:11435/v1',
  apiKey: 'test-key',
  model: 'test-model'
});

// Mock global fetch for SSE stream simulation
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"```typescript\\nexport async function "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"calculateTotalAsync(items: any[]): Promise<number> {\\n"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"  return 100;\\n}\\n```"}}]}\n\n',
    'data: [DONE]\n\n'
  ];

  let chunkIndex = 0;
  const readable = new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(encoder.encode(chunks[chunkIndex++]));
      } else {
        controller.close();
      }
    }
  });

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
};

try {
  const result = await AgentClient.generateInlineTransform({
    instruction: 'Convert to async function',
    filePath: 'src/calc.ts',
    languageId: 'typescript',
    selectedCode: 'function calculateTotal(items) { return 100; }',
    prefixContext: '// Header\n',
    suffixContext: '\n// Footer'
  });

  assert(result.includes('calculateTotalAsync'), 'Should contain transformed async function');
  assert(!result.includes('```'), 'Should not contain markdown code fences');
  console.log('✓ In-memory SSE streaming inline transform response verified!');
  console.log('  Transformed output:\n' + result.split('\n').map(l => '    ' + l).join('\n'));
} finally {
  globalThis.fetch = originalFetch;
}

console.log('\n🎉 ALL INLINE TRANSFORM UNIT TESTS PASSED CLEANLY!\n');
