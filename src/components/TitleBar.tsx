import { cx } from "../lib/styles";

type Props = { paused: boolean };

export function TitleBar({ paused }: Props) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-app-line bg-app-surface px-4 py-2">
      <div>
        <h1 className="text-[15px] font-semibold text-app-text">
          Linux Network Monitor &amp; Controller
        </h1>
      </div>
      <div className="ml-auto flex items-center gap-3.5">
        <div
          className={cx(
            "flex items-center gap-1.5 whitespace-nowrap text-xs transition-colors",
            paused ? "text-app-orange" : "text-app-green",
          )}
        >
          <div
            className={cx(
              "h-2 w-2 rounded-full transition",
              paused
                ? "bg-app-orange shadow-[0_0_0_4px_#f0883e1f]"
                : "bg-app-green shadow-[0_0_0_4px_#3fb95018]",
            )}
          />
          <span>{paused ? "Monitoring Paused" : "Monitoring Active"}</span>
        </div>
      </div>
    </header>
  );
}
