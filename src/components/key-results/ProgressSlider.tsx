interface ProgressSliderProps {
  value: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}

export function ProgressSlider({ value, max, unit, onChange }: ProgressSliderProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">Update Progress</span>
        <span className="font-medium text-gray-900">
          {value} / {max} {unit}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max={max}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
      />
      <div className="flex justify-between text-xs text-gray-400">
        <span>0</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
