export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  label: string;
  tone?: 'brand' | 'good';
}

export default function ProgressBar({ value, label, tone = 'brand' }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
      className="h-6 w-full overflow-hidden bg-canvas ring-2 ring-line"
    >
      <div
        className={`h-full transition-[width] duration-100 ease-linear ${
          tone === 'good' ? 'bg-good' : 'bg-brand'
        }`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
