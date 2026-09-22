/**
 * Utility functions for Mock Workspace
 */

export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

export function sanitizeInput(text: string): string {
  return text.trim();
}
