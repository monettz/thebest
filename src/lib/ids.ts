/** Stable small number for a user uuid, so screens that expect a numeric user id keep working. */
export function userNumId(uuid: string): number {
  return parseInt(uuid.replace(/-/g, '').slice(0, 8), 16) || 1;
}
