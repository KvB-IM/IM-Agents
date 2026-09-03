import AppHeader from "@/components/AppHeader";
import TabBar from "@/components/TabBar";
import { DraftProvider } from "@/components/DraftContext";
import { requireAgent } from "@/lib/session";
import { hsConfigured } from "@/lib/healthsherpa";
import { usingLiveCrm } from "@/lib/store";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const agent = await requireAgent();

  return (
    <DraftProvider>
      {/* Either upstream on fixtures earns the badge. Quoting a client off
          invented premiums, or reading a list of invented submissions, are both
          things someone has to be able to see at a glance. */}
      <AppHeader agentName={agent.name} fixture={!hsConfigured() || !(await usingLiveCrm())} />
      {/* No horizontal padding below `sm`: containers go full-bleed and inset
          their own content. See the Card comment in components/ui.tsx. */}
      <main
        className="mx-auto max-w-2xl pt-4 sm:px-4"
        style={{ paddingBottom: "calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 1rem)" }}
      >
        {children}
      </main>
      <TabBar />
    </DraftProvider>
  );
}
