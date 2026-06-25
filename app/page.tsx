import { redirect } from "next/navigation";
import { getUserId } from "@/lib/session";

export default async function Home() {
  const userId = await getUserId();
  redirect(userId ? "/dashboard" : "/onboarding");
}
