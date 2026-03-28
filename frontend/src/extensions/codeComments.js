// frontend/src/extensions/codeComments.js
// CodeMirror 6 extension for inline code comments.
// Renders a textarea widget below annotated lines. Communicates with the
// host component via callbacks (no Vue/Pinia dependency).

import { StateField, StateEffect } from '@codemirror/state'
import { EditorView, Decoration, WidgetType, ViewPlugin } from '@codemirror/view'

// ─── Effects ────────────────────────────────────────────────────────────────

/**
 * Sync all comments for this editor from the store.
 * Value: Array<{ lineNumber: number, content: string, lineText: string }>
 * Dispatched by the host component when the store changes (e.g. after hydration).
 */
export const syncCommentsEffect = StateEffect.define()

/** Add a new comment widget at a line. Value: { lineNumber: number, lineText: string } */
const addCommentEffect = StateEffect.define()

/** Remove a comment widget at a line. Value: { lineNumber: number } */
const removeCommentEffect = StateEffect.define()

// ─── Widget ─────────────────────────────────────────────────────────────────

class CodeCommentWidget extends WidgetType {
    constructor(lineNumber, content, callbacks) {
        super()
        this.lineNumber = lineNumber
        this.content = content
        this.callbacks = callbacks
    }

    toDOM(view) {
        const wrap = document.createElement('div')
        wrap.className = 'cm-code-comment-wrap'

        const textarea = document.createElement('textarea')
        textarea.className = 'cm-code-comment-textarea'
        textarea.value = this.content
        textarea.rows = 3
        textarea.placeholder = 'Add a comment...'

        // Track buttons that depend on textarea content
        const contentDependentBtns = []

        /** Update disabled state of content-dependent buttons. */
        const updateBtnState = () => {
            const hasContent = textarea.value.trim().length > 0
            for (const btn of contentDependentBtns) btn.disabled = !hasContent
        }

        // Notify on input — count sync is handled externally by the Vue
        // watcher in CodeEditor/DiffEditor which dispatches a custom event.
        textarea.addEventListener('input', () => {
            this.callbacks.onUpdate(this.lineNumber, textarea.value)
            updateBtnState()
        })

        // Close on Escape
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                view.dispatch({ effects: removeCommentEffect.of({ lineNumber: this.lineNumber }) })
                this.callbacks.onRemove(this.lineNumber)
                view.focus()
            }
        })

        const actions = document.createElement('div')
        actions.className = 'cm-code-comment-actions'

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'cm-code-comment-cancel'
        cancelBtn.textContent = 'Cancel'
        cancelBtn.type = 'button'
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            view.dispatch({ effects: removeCommentEffect.of({ lineNumber: this.lineNumber }) })
            this.callbacks.onRemove(this.lineNumber)
            view.focus()
        })

        actions.appendChild(cancelBtn)

        if (this.callbacks.onAddToMessage) {
            const addBtn = document.createElement('button')
            addBtn.className = 'cm-code-comment-add-to-msg'
            addBtn.textContent = 'Add to message'
            addBtn.type = 'button'
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                view.dispatch({ effects: removeCommentEffect.of({ lineNumber: this.lineNumber }) })
                this.callbacks.onAddToMessage(this.lineNumber)
            })
            contentDependentBtns.push(addBtn)
            actions.appendChild(addBtn)
        }

        // "Add all" button — visibility managed via a 'code-comment-count-changed'
        // custom event dispatched by the Vue watcher in CodeEditor/DiffEditor.
        // The watcher reacts to Pinia store changes (session-wide, all sources)
        // and bridges them to CM6 widgets via this DOM event.
        if (this.callbacks.onAddAllToMessage) {
            const addAllBtn = document.createElement('button')
            addAllBtn.className = 'cm-code-comment-add-all-to-msg'
            addAllBtn.type = 'button'
            addAllBtn.addEventListener('click', (e) => {
                e.stopPropagation()
                view.dispatch({ effects: syncCommentsEffect.of([]) })
                this.callbacks.onAddAllToMessage()
            })

            /** Show/hide the button based on count. */
            const updateAddAll = (count) => {
                if (count >= 2) {
                    addAllBtn.style.display = ''
                    addAllBtn.textContent = `Add all (${count})`
                } else {
                    addAllBtn.style.display = 'none'
                }
            }

            // Set initial state from store
            const initialCount = this.callbacks.getSessionCommentCount
                ? this.callbacks.getSessionCommentCount() : 0
            updateAddAll(initialCount)

            // Listen for count changes broadcast by the Vue watcher
            view.dom.addEventListener('code-comment-count-changed', (e) => {
                updateAddAll(e.detail.count)
            })

            actions.appendChild(addAllBtn)
        }

        wrap.appendChild(textarea)

        // Dismissible help text (persisted in localStorage)
        const HELP_DISMISSED_KEY = 'twicc-code-comments-help-dismissed'
        if (!localStorage.getItem(HELP_DISMISSED_KEY)) {
            const helpWrap = document.createElement('div')
            helpWrap.className = 'cm-code-comment-help'

            const helpSpan = document.createElement('span')
            helpSpan.textContent = 'Annotate code lines for your next message to Claude. '
                + 'Use "Add to message" to insert the formatted comment into the message input. '
                + 'You can annotate multiple lines across files and send them all at once.'

            const dismissLink = document.createElement('a')
            dismissLink.className = 'cm-code-comment-help-dismiss'
            dismissLink.textContent = 'Don\u2019t show again'
            dismissLink.href = '#'
            dismissLink.addEventListener('click', (e) => {
                e.preventDefault()
                e.stopPropagation()
                localStorage.setItem(HELP_DISMISSED_KEY, '1')
                helpWrap.remove()
            })

            helpWrap.appendChild(helpSpan)
            helpWrap.appendChild(document.createTextNode(' '))
            helpWrap.appendChild(dismissLink)
            wrap.appendChild(helpWrap)
        }

        wrap.appendChild(actions)

        // Set initial disabled state for content-dependent buttons
        updateBtnState()

        // Auto-focus only for newly added comments (empty content), not restored ones
        if (!this.content) {
            requestAnimationFrame(() => textarea.focus())
        }

        return wrap
    }

    eq(other) {
        return this.lineNumber === other.lineNumber && this.content === other.content
    }

    get estimatedHeight() {
        return 100
    }

    ignoreEvent() {
        return true
    }
}

// ─── State field ────────────────────────────────────────────────────────────

/**
 * Build the DecorationSet from a line→content map.
 */
function buildDecorations(commentsMap, callbacks, state) {
    const decorations = []
    for (const [lineNumber, data] of commentsMap) {
        if (lineNumber < 1 || lineNumber > state.doc.lines) continue
        const line = state.doc.line(lineNumber)
        decorations.push(
            Decoration.widget({
                widget: new CodeCommentWidget(lineNumber, data.content, callbacks),
                block: true,
                side: 1,
            }).range(line.to)
        )
    }
    decorations.sort((a, b) => a.from - b.from)
    return Decoration.set(decorations)
}

function createField(callbacks, initialComments) {
    return StateField.define({
        create(state) {
            const map = new Map()
            for (const { lineNumber, content, lineText } of initialComments) {
                map.set(lineNumber, { content, lineText: lineText || '' })
            }
            return {
                commentsMap: map,
                deco: buildDecorations(map, callbacks, state),
            }
        },

        update(fieldState, tr) {
            let { commentsMap, deco } = fieldState
            let changed = false

            for (const effect of tr.effects) {
                if (effect.is(syncCommentsEffect)) {
                    commentsMap = new Map()
                    for (const { lineNumber, content, lineText } of effect.value) {
                        commentsMap.set(lineNumber, { content, lineText: lineText || '' })
                    }
                    changed = true
                } else if (effect.is(addCommentEffect)) {
                    const { lineNumber, lineText } = effect.value
                    if (!commentsMap.has(lineNumber)) {
                        commentsMap = new Map(commentsMap)
                        commentsMap.set(lineNumber, { content: '', lineText: lineText || '' })
                        changed = true
                    }
                } else if (effect.is(removeCommentEffect)) {
                    const { lineNumber } = effect.value
                    if (commentsMap.has(lineNumber)) {
                        commentsMap = new Map(commentsMap)
                        commentsMap.delete(lineNumber)
                        changed = true
                    }
                }
            }

            if (changed) {
                return {
                    commentsMap,
                    deco: buildDecorations(commentsMap, callbacks, tr.state),
                }
            }

            if (tr.docChanged) {
                return {
                    commentsMap,
                    deco: buildDecorations(commentsMap, callbacks, tr.state),
                }
            }

            return fieldState
        },

        provide(field) {
            return EditorView.decorations.from(field, (val) => val.deco)
        },
    })
}

// ─── Gutter click handler ───────────────────────────────────────────────────
// EditorView.domEventHandlers listens on contentDOM, but gutter elements are
// siblings of contentDOM inside .cm-scroller — clicks on the gutter never
// reach contentDOM. We use a ViewPlugin that registers a click handler on
// view.dom (.cm-editor), which is the common ancestor of both.

function createGutterClickPlugin(callbacks, field) {
    return ViewPlugin.fromClass(class {
        constructor(view) {
            this.view = view
            this.handleClick = this.handleClick.bind(this)
            view.dom.addEventListener('click', this.handleClick)
        }

        handleClick(event) {
            const gutterEl = event.target.closest('.cm-lineNumbers .cm-gutterElement')
            if (!gutterEl) return

            const view = this.view
            const gutterRect = gutterEl.getBoundingClientRect()
            const y = gutterRect.top + gutterRect.height / 2
            const contentRect = view.contentDOM.getBoundingClientRect()
            const pos = view.posAtCoords({ x: contentRect.left + 1, y })
            if (pos === null) return

            const line = view.state.doc.lineAt(pos)
            const lineText = line.text

            // Check if this line already has a comment
            const fieldValue = view.state.field(field)
            if (fieldValue?.commentsMap.has(line.number)) {
                return // Already has a comment, do nothing
            }

            // Add a new comment
            view.dispatch({ effects: addCommentEffect.of({ lineNumber: line.number, lineText }) })
            callbacks.onAdd(line.number, lineText)

            event.preventDefault()
        }

        destroy() {
            this.view.dom.removeEventListener('click', this.handleClick)
        }
    })
}

// ─── Theme ──────────────────────────────────────────────────────────────────

const baseTheme = EditorView.baseTheme({
    '& .cm-lineNumbers .cm-gutterElement': {
        cursor: 'pointer',
    },
    '& .cm-code-comment-wrap': {
        padding: '6px 12px 6px 8px',
        borderTop: '1px solid var(--wa-color-border-default, rgba(128, 128, 128, 0.2))',
        borderBottom: '1px solid var(--wa-color-border-default, rgba(128, 128, 128, 0.2))',
        backgroundColor: 'var(--wa-color-surface-lowered, rgba(128, 128, 128, 0.06))',
    },
    '& .cm-code-comment-textarea': {
        display: 'block',
        width: '100%',
        minHeight: '60px',
        padding: '8px',
        border: '1px solid var(--wa-color-border-default, rgba(128, 128, 128, 0.3))',
        borderRadius: '4px',
        backgroundColor: 'var(--wa-color-surface-default, transparent)',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: '1.4',
        resize: 'vertical',
        outline: 'none',
        boxSizing: 'border-box',
    },
    '& .cm-code-comment-textarea:focus': {
        borderColor: 'var(--wa-color-primary, rgba(100, 150, 255, 0.5))',
        boxShadow: '0 0 0 2px color-mix(in srgb, var(--wa-color-primary, rgba(100, 150, 255, 0.15)) 20%, transparent)',
    },
    '& .cm-code-comment-textarea::placeholder': {
        color: 'var(--wa-color-text-quiet, rgba(128, 128, 128, 0.6))',
    },
    '& .cm-code-comment-help': {
        fontSize: '0.8em',
        lineHeight: '1.3',
        color: 'var(--wa-color-text-quiet, rgba(128, 128, 128, 0.6))',
        marginTop: '4px',
    },
    '& .cm-code-comment-help-dismiss': {
        color: 'var(--wa-color-text-quiet, rgba(128, 128, 128, 0.6))',
        textDecoration: 'underline',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    },
    '& .cm-code-comment-help-dismiss:hover': {
        color: 'inherit',
    },
    '& .cm-code-comment-actions': {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '6px',
        marginTop: '4px',
    },
    '& .cm-code-comment-cancel': {
        padding: '2px 12px',
        border: '1px solid var(--wa-color-border-default, rgba(128, 128, 128, 0.3))',
        borderRadius: '4px',
        backgroundColor: 'transparent',
        color: 'inherit',
        fontSize: '0.85em',
        cursor: 'pointer',
        outline: 'none',
    },
    '& .cm-code-comment-cancel:hover': {
        backgroundColor: 'var(--wa-color-surface-lowered, rgba(128, 128, 128, 0.1))',
    },
    '& .cm-code-comment-add-to-msg, & .cm-code-comment-add-all-to-msg': {
        padding: '2px 12px',
        border: '1px solid var(--wa-color-border-default, rgba(128, 128, 128, 0.3))',
        borderRadius: '4px',
        backgroundColor: 'transparent',
        color: 'inherit',
        fontSize: '0.85em',
        cursor: 'pointer',
        outline: 'none',
    },
    '& .cm-code-comment-add-to-msg:hover:not(:disabled), & .cm-code-comment-add-all-to-msg:hover:not(:disabled)': {
        backgroundColor: 'var(--wa-color-surface-lowered, rgba(128, 128, 128, 0.1))',
    },
    '& .cm-code-comment-add-to-msg:disabled, & .cm-code-comment-add-all-to-msg:disabled': {
        opacity: '0.4',
        cursor: 'default',
    },
})

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a CodeMirror extension for inline code comments.
 *
 * @param {Object} options
 * @param {Array<{lineNumber: number, content: string, lineText: string}>} options.initialComments
 * @param {(lineNumber: number, lineText: string) => void} options.onAdd
 * @param {(lineNumber: number, content: string) => void} options.onUpdate
 * @param {(lineNumber: number) => void} options.onRemove
 * @param {((lineNumber: number) => void)|null} options.onAddToMessage
 * @param {(() => void)|null} options.onAddAllToMessage
 * @returns {import('@codemirror/state').Extension[]}
 */
export function createCodeCommentsExtension({ initialComments = [], onAdd, onUpdate, onRemove, onAddToMessage, onAddAllToMessage, getSessionCommentCount }) {
    const callbacks = { onAdd, onUpdate, onRemove, onAddToMessage, onAddAllToMessage, getSessionCommentCount }
    const field = createField(callbacks, initialComments)
    const gutterPlugin = createGutterClickPlugin(callbacks, field)
    return [field, gutterPlugin, baseTheme]
}
