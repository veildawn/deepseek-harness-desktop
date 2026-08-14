/**
 * Classify a renderer navigation without granting arbitrary sites an Electron window.
 * @param {string} target - requested URL.
 * @param {string} applicationOrigin - active Harness origin.
 * @returns {'allow' | 'external' | 'deny'} navigation disposition.
 */
export function classifyNavigation(target, applicationOrigin) {
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return 'deny'
  }
  if (parsed.origin === applicationOrigin) return 'allow'
  if (parsed.protocol === 'https:') return 'external'
  return 'deny'
}
