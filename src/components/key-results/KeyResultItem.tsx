import { useState } from 'react';
import type { KeyResult } from '../../types';
import { useOKRStore, type OKRStore } from '../../store/okrStore';
import { ProgressBar } from '../common/ProgressBar';
import { Button } from '../common/Button';
import { ProgressSlider } from './ProgressSlider';

interface KeyResultItemProps {
  keyResult: KeyResult;
}

export function KeyResultItem({ keyResult }: KeyResultItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [currentValue, setCurrentValue] = useState(keyResult.currentValue);

  const updateKeyResult = useOKRStore((state: OKRStore) => state.updateKeyResult);
  const deleteKeyResult = useOKRStore((state: OKRStore) => state.deleteKeyResult);

  const handleUpdateProgress = (value: number) => {
    setCurrentValue(value);
    updateKeyResult(keyResult.id, { currentValue: value });
  };

  return (
    <div className="bg-gray-50 rounded-md p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">{keyResult.title}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <span>
              {keyResult.currentValue} / {keyResult.targetValue} {keyResult.unit}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(!isEditing)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteKeyResult(keyResult.id)}
          >
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </Button>
        </div>
      </div>

      <div className="mt-2">
        <ProgressBar progress={keyResult.progress} size="sm" />
      </div>

      {isEditing && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <ProgressSlider
            value={currentValue}
            max={keyResult.targetValue}
            unit={keyResult.unit}
            onChange={handleUpdateProgress}
          />
        </div>
      )}
    </div>
  );
}
