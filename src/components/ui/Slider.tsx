import { cn } from "@/lib/cn";

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  valueLabel?: string;
  disabled?: boolean;
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  valueLabel,
  disabled,
}: SliderProps) {
  return (
    <div className="flex items-center gap-3">
      {label && (
        <span className="text-sm text-text-secondary whitespace-nowrap">
          {label}
        </span>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className={cn(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-sm",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:shadow-sm",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      {valueLabel && (
        <span className="min-w-[3.5rem] text-right text-sm text-text-muted">
          {valueLabel}
        </span>
      )}
    </div>
  );
}
