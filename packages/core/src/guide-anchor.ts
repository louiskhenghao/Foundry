/**
 * The anchor of a guide heading, GitHub style: lowercase, punctuation dropped, each space a hyphen
 * ("Models & limits" → "models--limits"). The in-app Help page and the guide's link test share it,
 * so a "?" link that works in the app also works on GitHub.
 */
export function headingAnchor(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}
