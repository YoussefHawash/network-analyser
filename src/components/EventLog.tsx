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
    <section className="event-panel">
      <div className="panel-header">
        <div className="panel-title">Event Log</div>
        <button type="button" className="clear-btn" onClick={onClear}>Clear Log</button>
      </div>
      <div className="event-list">
        {events.length === 0 ? (
          <div className="empty-state">No events logged.</div>
        ) : (
          events.slice(0, 8).map((event) => (
            <div key={event.id} className="event-row">
              <span className="event-time">{event.time}</span>
              <div className={`event-dot ed-${event.tone}`} />
              <span className="event-text" dangerouslySetInnerHTML={{ __html: event.html }} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
