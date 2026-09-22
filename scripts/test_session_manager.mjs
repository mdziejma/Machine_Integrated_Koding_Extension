import assert from 'node:assert';

// Mock VS Code Memento storage
class MockMemento {
  constructor() {
    this.storage = new Map();
  }
  get(key, defaultValue) {
    if (this.storage.has(key)) {
      return this.storage.get(key);
    }
    return defaultValue;
  }
  async update(key, value) {
    this.storage.set(key, value);
  }
}

// We dynamically import the compiled SessionManager
const { SessionManager } = await import('../out/agent/sessionManager.js');

console.log('🧪 Starting SessionManager test suite...');

const mockMemento = new MockMemento();
SessionManager.initialize(mockMemento);

// 1. Initial State
const activeThread = SessionManager.getActiveThread();
assert(activeThread, 'Should initialize with an active thread');
assert.strictEqual(activeThread.title, 'New Chat');
assert.strictEqual(activeThread.messages.length, 0);
console.log('✓ Initial thread setup verified.');

// 2. Save active messages and title auto-derivation
await SessionManager.saveActiveMessages([
  {
    role: 'user',
    content: '[SPECIALIZED SKILL ACTIVATED: test-skill]\n[ACTIVE FILE: /src/app.ts]\n```typescript\nconst x = 1;\n```\nRefactor the authentication middleware'
  },
  {
    role: 'assistant',
    content: 'Sure, let me refactor the middleware.'
  }
]);

const updatedThread = SessionManager.getActiveThread();
assert.strictEqual(updatedThread.messages.length, 2);
assert.strictEqual(updatedThread.title, 'Refactor the authentication middleware');
console.log('✓ Message persistence and clean title auto-derivation verified:', updatedThread.title);

// 3. Create new thread
const thread2 = await SessionManager.createNewThread('Bug fix session');
assert.strictEqual(SessionManager.getActiveThread().id, thread2.id);
assert.strictEqual(thread2.title, 'Bug fix session');

const allThreads = SessionManager.getAllThreads();
assert.strictEqual(allThreads.length, 2);
const activeSummary = allThreads.find((t) => t.isActive);
assert(activeSummary, 'Active thread summary should exist');
assert.strictEqual(activeSummary.id, thread2.id);
console.log('✓ Multi-thread creation and summary list verified.');

// 4. Switch threads
const switched = await SessionManager.switchThread(activeThread.id);
assert.strictEqual(switched.id, activeThread.id);
assert.strictEqual(SessionManager.getActiveThread().id, activeThread.id);
console.log('✓ Thread switching verified.');

// 5. Delete thread
await SessionManager.deleteThread(thread2.id);
const threadsAfterDelete = SessionManager.getAllThreads();
assert.strictEqual(threadsAfterDelete.length, 1);
assert.strictEqual(threadsAfterDelete[0].id, activeThread.id);
console.log('✓ Thread deletion verified.');

// 6. Persistence across restart (re-initialize with same Memento)
SessionManager.initialize(mockMemento);
const restoredActive = SessionManager.getActiveThread();
assert.strictEqual(restoredActive.id, activeThread.id);
assert.strictEqual(restoredActive.messages.length, 2);
assert.strictEqual(restoredActive.title, 'Refactor the authentication middleware');
console.log('✓ Cross-session persistence & state restoration verified!');

console.log('\n🎉 ALL SESSION PERSISTENCE TESTS PASSED CLEANLY!\n');
