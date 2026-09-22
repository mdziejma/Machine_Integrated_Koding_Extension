import * as vscode from 'vscode';
import { ChatMessage } from './client.js';

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isActive: boolean;
}

/**
 * Session & Thread Persistence Manager for M.I.K.E.
 * Automatically persists active conversation history and manages past sessions across VS Code restarts.
 */
export class SessionManager {
  private static readonly STORAGE_KEY_THREADS = 'mike.chatThreads.v1';
  private static readonly STORAGE_KEY_ACTIVE_ID = 'mike.activeThreadId.v1';
  private static _storage?: vscode.Memento;
  private static _activeThreadId?: string;
  private static _threads: Map<string, ChatThread> = new Map();

  public static initialize(storage: vscode.Memento): void {
    this._storage = storage;
    this.loadFromStorage();
  }

  private static loadFromStorage(): void {
    if (!this._storage) return;

    const raw = this._storage.get<Record<string, ChatThread>>(this.STORAGE_KEY_THREADS, {});
    this._threads = new Map(Object.entries(raw));

    this._activeThreadId = this._storage.get<string>(this.STORAGE_KEY_ACTIVE_ID);
    if (!this._activeThreadId || !this._threads.has(this._activeThreadId)) {
      const newThread = this.createNewThreadSync('New Chat');
      this._activeThreadId = newThread.id;
      this.persist();
    }
  }

  private static async persist(): Promise<void> {
    if (!this._storage) return;

    const obj: Record<string, ChatThread> = {};
    for (const [id, thread] of this._threads.entries()) {
      obj[id] = thread;
    }

    await this._storage.update(this.STORAGE_KEY_THREADS, obj);
    await this._storage.update(this.STORAGE_KEY_ACTIVE_ID, this._activeThreadId);
  }

  private static createNewThreadSync(title?: string): ChatThread {
    const id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const thread: ChatThread = {
      id,
      title: title || 'New Chat',
      createdAt: now,
      updatedAt: now,
      messages: []
    };
    this._threads.set(id, thread);
    return thread;
  }

  /**
   * Retrieves the currently active conversation thread.
   */
  public static getActiveThread(): ChatThread {
    if (!this._activeThreadId || !this._threads.has(this._activeThreadId)) {
      const newThread = this.createNewThreadSync('New Chat');
      this._activeThreadId = newThread.id;
      this.persist();
      return newThread;
    }
    return this._threads.get(this._activeThreadId)!;
  }

  /**
   * Saves updated messages to the active thread and auto-derives title from first user prompt.
   */
  public static async saveActiveMessages(messages: ChatMessage[]): Promise<void> {
    const thread = this.getActiveThread();
    thread.messages = messages;
    thread.updatedAt = Date.now();

    // Auto-derive title if default
    if (thread.title === 'New Chat' || thread.title.startsWith('Thread ')) {
      const firstUserMsg = messages.find((m) => m.role === 'user' && m.content);
      if (firstUserMsg && firstUserMsg.content) {
        // Strip out skill tags and active file/selection wrappers for cleaner title
        const cleanTitle = firstUserMsg.content
          .replace(/\[SPECIALIZED SKILL ACTIVATED:[^\]]+\]/g, '')
          .replace(/\[ACTIVE FILE:[^\]]+\]\s*```[\s\S]*?```/g, '')
          .replace(/\[ACTIVE SELECTION:[^\]]+\]\s*```[\s\S]*?```/g, '')
          .trim();
        if (cleanTitle) {
          thread.title = cleanTitle.slice(0, 40) + (cleanTitle.length > 40 ? '...' : '');
        }
      }
    }

    await this.persist();
  }

  /**
   * Creates a brand new chat thread and sets it active.
   */
  public static async createNewThread(title?: string): Promise<ChatThread> {
    const thread = this.createNewThreadSync(title);
    this._activeThreadId = thread.id;
    await this.persist();
    return thread;
  }

  /**
   * Switches active thread to a previously saved thread by ID.
   */
  public static async switchThread(threadId: string): Promise<ChatThread | null> {
    if (!this._threads.has(threadId)) {
      return null;
    }
    this._activeThreadId = threadId;
    await this.persist();
    return this._threads.get(threadId)!;
  }

  /**
   * Deletes a thread by ID. If active, automatically switches to next available thread.
   */
  public static async deleteThread(threadId: string): Promise<boolean> {
    if (!this._threads.has(threadId)) {
      return false;
    }

    this._threads.delete(threadId);

    if (this._activeThreadId === threadId) {
      const remaining = Array.from(this._threads.keys());
      if (remaining.length > 0) {
        this._activeThreadId = remaining[0];
      } else {
        const newThread = this.createNewThreadSync('New Chat');
        this._activeThreadId = newThread.id;
      }
    }

    await this.persist();
    return true;
  }

  /**
   * Returns list of thread summaries sorted with most recent first.
   */
  public static getAllThreads(): ChatThreadSummary[] {
    return Array.from(this._threads.values())
      .map((t) => ({
        id: t.id,
        title: t.title,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        messageCount: t.messages.filter((m) => m.role !== 'system').length,
        isActive: t.id === this._activeThreadId
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Clears all past history and resets to a single empty chat.
   */
  public static async clearAll(): Promise<void> {
    this._threads.clear();
    const newThread = this.createNewThreadSync('New Chat');
    this._activeThreadId = newThread.id;
    await this.persist();
  }
}
