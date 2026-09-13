import { Card } from "../components/Surface";
import { EmptyState } from "../components/EmptyState";
import { IconSliders } from "../components/icons";

/** Shown when a screen's data source isn't configured yet — always with the way to fix it. */
export function NeedsSetup({ title, body, onOpenTab }: { title: string; body: string; onOpenTab: (tab: "settings") => void }) {
  return (
    <Card padding={0}>
      <EmptyState
        icon={<IconSliders size={17} />}
        title={title}
        body={body}
        action={
          <button className="chip" onClick={() => onOpenTab("settings")}>
            Open Settings
          </button>
        }
      />
    </Card>
  );
}
