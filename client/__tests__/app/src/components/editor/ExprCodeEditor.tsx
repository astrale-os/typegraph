import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view'
import { useRef, useEffect } from 'react'

interface ExprCodeEditorProps {
  value: string
  onChange: (value: string) => void
  onEvaluate?: () => void
}

export function ExprCodeEditor({ value, onChange, onEvaluate }: ExprCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const evalKeymap = onEvaluate
      ? keymap.of([
          {
            key: 'Ctrl-Enter',
            run: () => {
              onEvaluate()
              return true
            },
          },
        ])
      : keymap.of([])

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        closeBrackets(),
        javascript({ typescript: true }),
        oneDark,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap]),
        evalKeymap,
        EditorView.updateListener.of(
          (update: { docChanged: boolean; state: { doc: { toString: () => string } } }) => {
            if (update.docChanged) {
              onChange(update.state.doc.toString())
            }
          },
        ),
        EditorView.theme({
          '&': { fontSize: '12px', height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': { minHeight: '120px' },
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="border border-slate-700 rounded overflow-hidden" />
}
