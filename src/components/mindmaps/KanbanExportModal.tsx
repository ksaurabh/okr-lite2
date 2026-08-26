import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface Props {
  html: string;   // the board as standalone HTML
  plain: string;  // …and as plain text, for anywhere that won't take markup
  onClose: () => void;
}

type Copied = 'none' | 'board' | 'source';

// Export a kanban board: the HTML is shown so it can be read (and hand-copied),
// and the buttons put it on the clipboard — either as a formatted board that
// pastes into an email as a table, or as the markup itself.
export function KanbanExportModal({ html, plain, onClose }: Props) {
  const [copied, setCopied] = useState<Copied>('none');
  const [failed, setFailed] = useState(false);

  const flash = (what: Copied) => {
    setFailed(false);
    setCopied(what);
    window.setTimeout(() => setCopied('none'), 2000);
  };

  // A rich copy carries both flavours: mail clients take the HTML and paste a
  // real table, while a plain-text field gets the readable outline.
  const copyBoard = async () => {
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })]);
      } else {
        // Older browsers: no way to put HTML on the clipboard, so the outline
        // is what they get.
        await navigator.clipboard.writeText(plain);
      }
      flash('board');
    } catch {
      setFailed(true);
    }
  };

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(html);
      flash('source');
    } catch {
      setFailed(true);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Export board">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Copy the board and paste it into an email or a document — it arrives as a table, one column
          per list. The HTML behind it is below.
        </p>
        <textarea
          readOnly
          value={html}
          onFocus={e => e.currentTarget.select()}
          rows={10}
          className="w-full border border-gray-300 rounded-md p-2 font-mono text-[11px] leading-snug text-gray-700 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {failed && (
          <p className="text-xs text-red-600">
            The clipboard is blocked in this browser. Select the text above and copy it by hand.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={copySource}>
            {copied === 'source' ? 'Copied' : 'Copy HTML'}
          </Button>
          <Button onClick={copyBoard}>
            {copied === 'board' ? 'Copied' : 'Copy board'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
