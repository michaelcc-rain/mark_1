import { Panel } from "@/components/ui";

export function ConnectPrompt() {
  return (
    <Panel className="p-8 text-center">
      <h1 className="text-lg font-semibold text-slate-900">Connect Rain to continue</h1>
      <p className="mt-2 text-sm text-slate-500">
        Set <code className="font-mono-num">RAIN_API_KEY</code> in{" "}
        <code className="font-mono-num">.env.local</code> and restart the dev server.
      </p>
    </Panel>
  );
}
