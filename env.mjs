/**
 * Centralized environment access so execution/networking modules do not read
 * environment variables directly.
 */

const ENV = process.env;

export function getEnv(name, { trim = false } = {}) {
  const value = ENV[name];
  if (typeof value !== 'string') return undefined;
  return trim ? value.trim() : value;
}

export function hasEnv(name) {
  const value = ENV[name];
  return typeof value === 'string' && value.length > 0;
}
