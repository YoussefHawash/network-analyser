import { cx, panelHeader, panelTitle } from "../lib/styles";
import type { EventTone } from "../lib/types";

export type EventLogItem = {
  id: number;
  time: string;
  tone: EventTone;
  html: string;
};

type Props = { events: EventLogItem[]; onClear: () => void };

export function EventLog({ events, onClear }: Props) {
  return (
    <section className="rounded-lg border border-app-line bg-app-surface px-4 py-3.5">
      <div className={panelHeader}>
        <div className={panelTitle}>Event Log</div>
        <button
          type="button"
          className="min-h-7 rounded-md border border-app-border bg-transparent px-2.5 text-[11px] text-app-muted transition hover:border-app-blue/40 hover:bg-app-raised hover:text-app-text"
          onClick={onClear}
        >
          Clear Log
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {events.length === 0 ? (
          <div className="px-2 py-6 text-center text-app-muted">No events logged.</div>
        ) : (
          events.slice(0, 8).map((event) => (
            <div
              key={event.id}
              className="grid min-h-[25px] grid-cols-[54px_10px_1fr] items-center gap-2.5 py-1"
            >
              <span className="font-mono text-[11px] text-app-subtle">{event.time}</span>
              <div className={cx("h-[7px] w-[7px] rounded-full", dotClass(event.tone))} />
              <span
                className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-app-muted [&_.ev-blue]:text-app-blue [&_.ev-val]:text-app-orange [&_strong]:text-app-text"
                dangerouslySetInnerHTML={{ __html: event.html }}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function dotClass(tone: EventTone) {
  if (tone === "orange") return "bg-app-orange";
  if (tone === "blue") return "bg-app-blue";
  return "bg-app-green";
}
