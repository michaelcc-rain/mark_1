/** Extract a user-safe message from an unknown thrown value. */
export function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Please try again.";
}
