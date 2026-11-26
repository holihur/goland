import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ResizeDivider } from "./ResizeDivider";

export type DockPosition = "left" | "bottom" | "right";

export function DockOverlay({ preview }: { preview: DockPosition | null }) {
  const zones: Array<{ id: DockPosition; label: string; className: string }> = [
    { id: "left", label: "Left", className: "inset-y-0 left-0 w-1/4" },
    { id: "right", label: "Right", className: "inset-y-0 right-0 w-1/4" },
    { id: "bottom", label: "Bottom", className: "inset-x-0 bottom-0 h-1/3" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {zones.map((zone) => (
        <div
          key={zone.id}
          className={cn(
            "absolute flex items-center justify-center rounded-xl border-2 border-dashed text-[11px] font-medium uppercase tracking-[0.14em] transition-colors",
            zone.className,
            preview === zone.id
              ? "border-primary bg-primary/15 text-primary"
              : "border-border/80 bg-background/60 text-muted-foreground",
          )}
        >
          {zone.label}
        </div>
      ))}
    </div>
  );
}

export function BottomSidebarDock({
  compact,
  height,
  maxHeight,
  onResize,
  onReset,
  children,
}: {
  compact: boolean;
  height: number;
  maxHeight: number;
  onResize: (height: number) => void;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <>
      {!compact && (
        <ResizeDivider
          axis="y"
          value={height}
          min={120}
          max={maxHeight}
          label="Resize sidebar"
          onChange={onResize}
          onReset={onReset}
        />
      )}
      <aside
        data-testid="sidebar"
        className={cn(
          "flex min-h-0 flex-col overflow-hidden bg-panel",
          compact ? "absolute inset-x-0 bottom-0 z-30 h-[55vh] border-t shadow-2xl" : "shrink-0 border-t",
        )}
        style={compact ? undefined : { height }}
      >
        {children}
      </aside>
    </>
  );
}
