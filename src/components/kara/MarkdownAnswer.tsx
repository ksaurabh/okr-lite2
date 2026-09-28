import type { KeyboardEvent } from 'react';
import MDEditor, {
  bold, italic, strikethrough, title, divider, unorderedListCommand, orderedListCommand,
  checkedListCommand, link, quote, code, codeBlock, table, codeEdit, codePreview,
} from '@uiw/react-md-editor/nohighlight';
import rehypeSanitize from 'rehype-sanitize';

// Markdown editor for answering Kara: a formatting toolbar over a plain
// textarea, with a Write/Preview toggle. Uses @uiw/react-md-editor (MIT), in
// its build without syntax highlighting to keep it light. Rendering is
// sanitized, so raw HTML typed into an answer never becomes markup.

const TOOLBAR = [
  bold, italic, strikethrough, divider,
  title, divider,
  unorderedListCommand, orderedListCommand, checkedListCommand, divider,
  link, quote, code, codeBlock, table,
];
const VIEW_TOGGLE = [codeEdit, codePreview];
const REHYPE = [[rehypeSanitize]] as NonNullable<Parameters<typeof MDEditor.Markdown>[0]['rehypePlugins']>;

export function MarkdownAnswerEditor({ value, onChange, onSubmit, placeholder, height = 200, disabled, autoFocus }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  height?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (onSubmit && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
  };
  return (
    // The app is light-only; without this the editor follows the OS theme.
    <div data-color-mode="light" onKeyDown={onKeyDown} className={disabled ? 'pointer-events-none opacity-60' : ''}>
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? '')}
        commands={TOOLBAR}
        extraCommands={VIEW_TOGGLE}
        preview="edit"
        height={height}
        visibleDragbar={false}
        autoFocus={autoFocus}
        textareaProps={{ placeholder }}
        previewOptions={{ rehypePlugins: REHYPE }}
      />
    </div>
  );
}

export function MarkdownAnswerView({ text }: { text: string }) {
  return (
    <div data-color-mode="light">
      <MDEditor.Markdown source={text} rehypePlugins={REHYPE} style={{ background: 'transparent', fontSize: 14 }} />
    </div>
  );
}
