import { useEffect, useMemo, useRef } from "react";
import { useConsoleStore } from "../state/useConsoleStore";

const formatTime = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleTimeString();
};

const ConsolePanel = () => {
  const entries = useConsoleStore((s) => s.entries);
  const clearEntries = useConsoleStore((s) => s.clearEntries);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const renderedEntries = useMemo(
    () =>
      entries.map((entry) => (
        <div key={entry.id} className={`console-entry level-${entry.level}`}>
          <span className="console-meta">[{formatTime(entry.timestamp)}]</span>
          <span className="console-meta">[{entry.level.toUpperCase()}]</span>
          <span className="console-meta">[{entry.source}]</span>
          <span className="console-message">{entry.message}</span>
        </div>
      )),
    [entries]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="console-content" ref={scrollRef}>
      <div className="console-toolbar">
        <button onClick={clearEntries}>Clear</button>
      </div>

      <div className="console-entries">
        {renderedEntries}
        {entries.length === 0 && (
          <div className="console-empty">No log entries yet.</div>
        )}
      </div>
    </div>
  );
};

export default ConsolePanel;
