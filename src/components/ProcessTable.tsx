import { useState } from "react";
import { formatRate, totalRate } from "../lib/format";
import {
  badge,
  cx,
  iconButton,
  mutedCell,
  numeric,
  panel,
  panelHeader,
  panelTitle,
  tableShell,
  td,
  th,
} from "../lib/styles";
import type { ProcessTraffic, SortKey } from "../lib/types";
import { SelectField } from "./SelectField";
import { Sparkline } from "./Sparkline";

type Props = {
  processes: ProcessTraffic[];
  totalProcessCount: number;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
};

export function ProcessTable({
  processes,
  totalProcessCount,
  sortKey,
  onSortChange,
}: Props) {
  const [compact, setCompact] = useState(false);

  return (
    <section className={cx(panel, "flex h-[398px] flex-col overflow-hidden")}>
      <div className={panelHeader}>
        <div>
          <div className={panelTitle}>Process Network Usage</div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-app-muted">
          <span>Sort by:</span>
          <SelectField
            variant="sort"
            wrapperClassName="w-[92px]"
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
          >
            <option value="sent">Sent</option>
            <option value="received">Received</option>
            <option value="total">Total</option>
          </SelectField>
          <button
            type="button"
            className={iconButton}
            title="Toggle compact rows"
            aria-pressed={compact}
            onClick={() => setCompact((value) => !value)}
          >
            ≡
          </button>
        </div>
      </div>

      <div className={cx(tableShell, "min-h-[286px]")}>
        <table className="w-full min-w-[720px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[58px]" />
            <col className="w-[150px]" />
            <col className="w-[82px]" />
            <col className="w-16" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-[70px]" />
          </colgroup>
          <thead>
            <tr>
              <th className={th}>PID</th>
              <th className={th}>Process</th>
              <th className={th}>User</th>
              <th className={th}>Proto</th>
              <th className={th}>Received</th>
              <th className={th}>Sent</th>
              <th className={th}>Total</th>
              <th className={th}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {processes.length === 0 ? (
              <tr>
                <td className={td(compact)} colSpan={8}>
                  <div className="px-2 py-6 text-center text-app-muted">
                    No process traffic matches the current filters.
                  </div>
                </td>
              </tr>
            ) : (
              processes.map((process) => (
                <ProcessRow
                  key={process.pid}
                  process={process}
                  compact={compact}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-[11px] text-app-subtle">
        Showing {processes.length} of {totalProcessCount} active processes
      </div>
    </section>
  );
}

function ProcessRow({
  process,
  compact,
}: {
  process: ProcessTraffic;
  compact: boolean;
}) {
  const trendColor = process.sent > process.received ? "#388bfd" : "#3fb950";

  return (
    <tr className="group/row">
      <td className={td(compact, cx(mutedCell, numeric))}>{process.pid}</td>
      <td className={td(compact)}>
        <div
          className="flex min-w-0 items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap font-semibold"
          title={process.name}
        >
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
            {process.name}
          </span>
        </div>
      </td>
      <td className={td(compact, mutedCell)}>{process.user}</td>
      <td className={td(compact)}>
        <span className={badge}>{process.protocol}</span>
      </td>
      <td className={td(compact, cx("text-app-green", numeric))}>
        {formatRate(process.received)}
      </td>
      <td className={td(compact, cx("text-app-blue", numeric))}>
        {formatRate(process.sent)}
      </td>
      <td className={td(compact, cx("font-semibold", numeric))}>
        {formatRate(totalRate(process))}
      </td>
      <td className={td(compact)}>
        <Sparkline values={process.history} color={trendColor} />
      </td>
    </tr>
  );
}
