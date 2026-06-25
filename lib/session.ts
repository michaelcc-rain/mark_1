import { cookies } from "next/headers";

// No app-level auth: a single active demo user, tracked by httpOnly cookies.
// `cookies()` is async in current Next.js — always await it. Reading works in
// Server Components; writing (set/delete) only works in Server Actions or
// Route Handlers.
const USER_COOKIE = "rain_user_id";
const CARD_COOKIE = "rain_card_id";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export async function getUserId(): Promise<string | null> {
  return (await cookies()).get(USER_COOKIE)?.value ?? null;
}

export async function setUserId(id: string): Promise<void> {
  (await cookies()).set(USER_COOKIE, id, COOKIE_OPTS);
}

export async function getCardId(): Promise<string | null> {
  return (await cookies()).get(CARD_COOKIE)?.value ?? null;
}

export async function setCardId(id: string): Promise<void> {
  (await cookies()).set(CARD_COOKIE, id, COOKIE_OPTS);
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(USER_COOKIE);
  store.delete(CARD_COOKIE);
}
