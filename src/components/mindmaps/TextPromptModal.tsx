import type { ReactNode } from 'react';
import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface Props {
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  // Optional context shown above the field — what the thing being named is
  // part of, what renaming it affects, and so on.
  info?: ReactNode;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

// A small in-app text-entry dialog (used instead of window.prompt).
export function TextPromptModal({ title, label, initial, submitLabel, info, onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initial);
  return (
    <Modal isOpen onClose={onClose} title={title}>
      <div className="space-y-4">
        {info}
        <div>
          <label className="block text-sm text-gray-600 mb-1">{label}</label>
          <input
            type="text"
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onSubmit(value); onClose(); } }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onSubmit(value); onClose(); }}>{submitLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}
