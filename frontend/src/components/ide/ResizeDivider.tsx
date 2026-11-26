import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type DividerAxis = "x" | "y";

const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

export interface ResizeDividerProps {
  /** `x` resizes a width (vertical bar), `y` resizes a height (horizontal bar). */
  axis: DividerAxis;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset?: () => void;
  label: string;
  className?: string;
  /** Flips horizontal drag/key directions for a panel docked on the right. */
  invert?: boolean;
  /** Small visual handle shown in the middle of the divider. */
  showHandle?: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Pointer- and keyboard-accessible splitter. Dragging is implemented with
 * pointer capture so the resize keeps working when the cursor leaves the thin
 * divider; text selection and the cursor are locked while dragging.
 */
export function ResizeDivider({
  axis,
  value,
  min,
  max,
  onChange,
  onReset,
  label,
  className,
  invert = false,
  showHandle = true,
}: ResizeDividerProps) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ pointer: number; value: number } | null>(null);
  const latest = useRef({ onChange, min, max });

  useEffect(() => {
    latest.current = { onChange, min, max };
  }, [onChange, min, max]);

  useEffect(() => {
    if (!dragging) return;
    const previousSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    return () => {
      document.body.style.userSelect = previousSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [axis, dragging]);

  const stopDragging = useCallback((element?: Element | null) => {
    startRef.current = null;
    setDragging(false);
    if (element instanceof Element && typeof element.releasePointerCapture === "function") {
      const pointerId = element.getAttribute("data-pointer-id");
      if (pointerId) {
        try {
          element.releasePointerCapture(Number(pointerId));
        } catch {
          // Capture may already be released by the browser.
        }
      }
    }
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    startRef.current = { pointer: axis === "x" ? event.clientX : event.clientY, value };
    setDragging(true);
    const element = event.currentTarget;
    element.setAttribute("data-pointer-id", String(event.pointerId));
    if (typeof element.setPointerCapture === "function") {
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort; move events on the element still work.
      }
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    event.preventDefault();
    const pointer = axis === "x" ? event.clientX : event.clientY;
    const delta =
      axis === "x"
        ? invert
          ? start.pointer - pointer
          : pointer - start.pointer
        : start.pointer - pointer;
    latest.current.onChange(clamp(start.value + delta, latest.current.min, latest.current.max));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    stopDragging(event.currentTarget);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let delta = 0;
    if (axis === "x") {
      if (event.key === "ArrowLeft") delta = invert ? step : -step;
      else if (event.key === "ArrowRight") delta = invert ? -step : step;
    } else if (event.key === "ArrowUp") delta = step;
    else if (event.key === "ArrowDown") delta = -step;
    if (!delta) return;
    event.preventDefault();
    onChange(clamp(value + delta, min, max));
  };

  const orientation = axis === "x" ? "vertical" : "horizontal";

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      data-axis={axis}
      data-dragging={dragging ? "true" : "false"}
      className={cn(
        "group relative z-10 flex shrink-0 touch-none items-center justify-center bg-transparent outline-none",
        axis === "x" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        "hover:bg-primary/40 focus-visible:bg-primary/60",
        dragging && "bg-primary/60",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={() => stopDragging(null)}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onReset?.()}
    >
      {showHandle && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none rounded-full bg-border transition-colors group-hover:bg-primary/70",
            axis === "x" ? "h-8 w-0.5" : "h-0.5 w-8",
          )}
        />
      )}
    </div>
  );
}
