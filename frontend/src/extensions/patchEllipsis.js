// frontend/src/extensions/patchEllipsis.js
// Ellipsis separator widget for patch-only diffs (no originalFile).
// Replaces sentinel lines (null entries in lineMap) with a simple "···" block,
// reusing the .cm-collapsedLines style from smartCollapseUnchanged.

import { EditorView, Decoration, WidgetType } from '@codemirror/view'

// ─── Widget ────────────────────────────────────────────────────────────────

class EllipsisSeparatorWidget extends WidgetType {
    eq() { return true }

    toDOM() {
        const div = document.createElement('div')
        div.className = 'cm-collapsedLines cm-patchEllipsis'
        div.textContent = '···'
        return div
    }

    get estimatedHeight() { return 27 }
}

const ellipsisWidget = new EllipsisSeparatorWidget()

const baseStyles = EditorView.baseTheme({
    '.cm-patchEllipsis': {
        cursor: 'default',
        justifyContent: 'center',
    },
})

// ─── Entry point ───────────────────────────────────────────────────────────

/**
 * Build a static decoration set that replaces sentinel separator lines with
 * ellipsis block widgets.  Sentinel lines are identified by `null` entries
 * in the provided lineMap.
 *
 * @param {Array<number|null>} lineMap - Line number map (null = separator)
 * @returns {Extension} CodeMirror extension (static decorations)
 */
export function patchEllipsis(lineMap) {
    if (!lineMap) return []

    // Build decorations lazily from the initial state
    return [
        EditorView.decorations.compute([], (state) => {
            const decorations = []
            for (let i = 0; i < lineMap.length; i++) {
                if (lineMap[i] !== null) continue
                const docLine = i + 1  // lineMap is 0-indexed, doc lines are 1-based
                if (docLine > state.doc.lines) break
                const line = state.doc.line(docLine)
                decorations.push(
                    Decoration.replace({
                        widget: ellipsisWidget,
                        block: true,
                    }).range(line.from, line.to)
                )
            }
            return Decoration.set(decorations)
        }),
        baseStyles,
    ]
}
