export function SetupBanner() {
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 text-sm text-amber-800">
        <span className="font-semibold">Setup needed</span>
        <span className="text-amber-700">
          Add a sandbox <code className="font-mono-num">RAIN_API_KEY</code> to{" "}
          <code className="font-mono-num">.env.local</code> and restart the dev server to connect
          to Rain.
        </span>
      </div>
    </div>
  );
}
