import { useRef } from "react";
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
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "./editor.css";

interface MilkdownEditorProps {
  defaultValue: string;
  onChange?: (markdown: string) => void;
  readonly?: boolean;
}

function InnerEditor({ defaultValue, onChange, readonly }: MilkdownEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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

export function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <div className="milkdown-editor flex-1 overflow-y-auto">
        <InnerEditor {...props} />
      </div>
    </MilkdownProvider>
  );
}
