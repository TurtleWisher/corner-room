/**
 * Content frame for pages not yet rebuilt in their module stage (Stages 6 to 12). It is the
 * pre-Stage 5 <main> exactly, outside any .cr-scope, so legacy page bodies render as before
 * while the new shell sits around them. A page leaves this frame when its module is rebuilt.
 */
export function LegacyMain({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-10">
      {children}
    </main>
  );
}
