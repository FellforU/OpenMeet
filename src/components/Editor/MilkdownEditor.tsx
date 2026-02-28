import { useRef, useState, useCallback } from "react";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { indent } from "@milkdown/kit/plugin/indent";
import { trailing } from "@milkdown/kit/plugin/trailing";
import { Milkdown, MilkdownProvider, useEditor, useInstance } from "@milkdown/react";
import { callCommand } from "@milkdown/utils";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  insertHrCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "./editor.css";
import { EditorToolbar } from "./EditorToolbar";

interface MilkdownEditorProps {
  defaultValue: string;
  onChange?: (markdown: string) => void;
  readonly?: boolean;
}

function InnerEditor({ defaultValue, onChange, readonly }: MilkdownEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const markdownRef = useRef(defaultValue);

  useEditor((root) => {
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, defaultValue);

        if (readonly) {
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            editable: () => false,
          }));
        }

        if (onChangeRef.current) {
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            markdownRef.current = markdown;
            onChangeRef.current?.(markdown);
          });
        }
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(indent)
      .use(trailing);

    return editor;
    // Deps intentionally empty: editor initializes once per mount.
    // Callers MUST use React `key` to force remount when defaultValue/readonly changes.
  }, []);

  return <Milkdown />;
}

function EditorWithToolbar({ defaultValue, onChange }: MilkdownEditorProps) {
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState(defaultValue);
  const markdownRef = useRef(defaultValue);
  const [, getInstance] = useInstance();

  const handleChange = useCallback(
    (md: string) => {
      markdownRef.current = md;
      onChange?.(md);
    },
    [onChange],
  );

  const handleCommand = useCallback(
    (command: string) => {
      try {
        const editor = getInstance();
        if (!editor) return;

        switch (command) {
          case "toggleBold":
            editor.action(callCommand(toggleStrongCommand.key));
            break;
          case "toggleItalic":
            editor.action(callCommand(toggleEmphasisCommand.key));
            break;
          case "toggleStrikethrough":
            editor.action(callCommand(toggleStrikethroughCommand.key));
            break;
          case "heading1":
            editor.action(callCommand(wrapInHeadingCommand.key, 1));
            break;
          case "heading2":
            editor.action(callCommand(wrapInHeadingCommand.key, 2));
            break;
          case "heading3":
            editor.action(callCommand(wrapInHeadingCommand.key, 3));
            break;
          case "bulletList":
            editor.action(callCommand(wrapInBulletListCommand.key));
            break;
          case "orderedList":
            editor.action(callCommand(wrapInOrderedListCommand.key));
            break;
          case "blockquote":
            editor.action(callCommand(wrapInBlockquoteCommand.key));
            break;
          case "inlineCode":
            editor.action(callCommand(toggleInlineCodeCommand.key));
            break;
          case "hr":
            editor.action(callCommand(insertHrCommand.key));
            break;
        }
      } catch {
        // Editor may not be ready
      }
    },
    [getInstance],
  );

  const handleToggleSource = useCallback(() => {
    if (sourceMode) {
      // Switching back to WYSIWYG: sourceText is the latest
      markdownRef.current = sourceText;
      onChange?.(sourceText);
    } else {
      // Switching to source: capture current WYSIWYG markdown
      setSourceText(markdownRef.current);
    }
    setSourceMode((prev) => !prev);
  }, [sourceMode, sourceText, onChange]);

  const handleSourceChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setSourceText(value);
      markdownRef.current = value;
      onChange?.(value);
    },
    [onChange],
  );

  return (
    <div className="flex h-full flex-col">
      <EditorToolbar
        onCommand={handleCommand}
        sourceMode={sourceMode}
        onToggleSource={handleToggleSource}
      />
      {sourceMode ? (
        <textarea
          className="flex-1 resize-none bg-muted/30 p-3 font-mono text-sm leading-relaxed outline-none"
          value={sourceText}
          onChange={handleSourceChange}
          spellCheck={false}
        />
      ) : (
        <div className="milkdown-editor flex-1 overflow-y-auto">
          <InnerEditor
            key={sourceText}
            defaultValue={markdownRef.current}
            onChange={handleChange}
          />
        </div>
      )}
    </div>
  );
}

export function MilkdownEditor(props: MilkdownEditorProps) {
  if (props.readonly) {
    // Read-only mode: no toolbar, no source toggle
    return (
      <MilkdownProvider>
        <div className="milkdown-editor flex-1 overflow-y-auto">
          <InnerEditor {...props} />
        </div>
      </MilkdownProvider>
    );
  }

  return (
    <MilkdownProvider>
      <EditorWithToolbar {...props} />
    </MilkdownProvider>
  );
}
