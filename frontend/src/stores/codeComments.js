// frontend/src/stores/codeComments.js
// Pinia store for code comments (inline annotations on code lines).

import { toRaw } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { getAllCodeComments, saveCodeComment, deleteCodeComment } from '../utils/codeCommentsStorage'

// ─── Key helpers ────────────────────────────────────────────────────────────

/**
 * Build a serialized key from the 6 comment identity fields.
 * Uses \0 as separator (invalid in file paths on all OSes).
 */
export function buildCommentKey({ projectId, sessionId, filePath, source, sourceRef, lineNumber }) {
    return `${projectId}\0${sessionId}\0${filePath}\0${source}\0${sourceRef}\0${lineNumber}`
}

/**
 * Build the compound key array for IndexedDB operations (delete, get).
 */
export function buildKeyArray({ projectId, sessionId, filePath, source, sourceRef, lineNumber }) {
    return [projectId, sessionId, filePath, source, sourceRef, lineNumber]
}

// ─── Debounce timers (module-level, not reactive) ───────────────────────────

const _debouncers = {}
const DEBOUNCE_MS = 500

// ─── Store ──────────────────────────────────────────────────────────────────

export const useCodeCommentsStore = defineStore('codeComments', {
    state: () => ({
        /**
         * All comments indexed by serialized key.
         * @type {Object<string, {projectId: string, sessionId: string, filePath: string, source: string, sourceRef: string, lineNumber: number, content: string, createdAt: number, updatedAt: number}>}
         */
        comments: {},
    }),

    getters: {
        /**
         * Returns a function that filters comments matching a given context.
         * Usage: store.getCommentsForContext({ projectId, sessionId, filePath, source, sourceRef })
         * Returns an array of comment objects (with lineNumber and content).
         */
        getCommentsForContext: (state) => (context) => {
            if (!context) return []
            return Object.values(state.comments).filter(c =>
                c.projectId === context.projectId &&
                c.sessionId === context.sessionId &&
                c.filePath === context.filePath &&
                c.source === context.source &&
                c.sourceRef === (context.sourceRef ?? '')
            )
        },

        // ─── Hierarchical count getters (for indicators) ────────────────

        /** Count all comments in a project. */
        countByProject: (state) => (projectId) => {
            return Object.values(state.comments).filter(c => c.projectId === projectId).length
        },

        /** Count comments in a specific session. */
        countBySession: (state) => (projectId, sessionId) => {
            return Object.values(state.comments).filter(c =>
                c.projectId === projectId && c.sessionId === sessionId
            ).length
        },

        /** Get all comments for a session (across all files/sources). */
        getCommentsBySession: (state) => (projectId, sessionId) => {
            return Object.values(state.comments).filter(c =>
                c.projectId === projectId && c.sessionId === sessionId
            )
        },

        /** Count comments for a source tab (files/git/tool) within a session. */
        countBySource: (state) => (projectId, sessionId, source) => {
            return Object.values(state.comments).filter(c =>
                c.projectId === projectId && c.sessionId === sessionId && c.source === source
            ).length
        },

        /** Count comments for a specific source reference (commit SHA, tool use ID) within a session+source. */
        countBySourceRef: (state) => (projectId, sessionId, source, sourceRef) => {
            return Object.values(state.comments).filter(c =>
                c.projectId === projectId && c.sessionId === sessionId &&
                c.source === source && c.sourceRef === (sourceRef ?? '')
            ).length
        },

        /** Count comments for a specific file within a full context. */
        countByFile: (state) => (projectId, sessionId, source, sourceRef, filePath) => {
            return Object.values(state.comments).filter(c =>
                c.projectId === projectId && c.sessionId === sessionId &&
                c.source === source && c.sourceRef === (sourceRef ?? '') &&
                c.filePath === filePath
            ).length
        },
    },

    actions: {
        /**
         * Hydrate the store from IndexedDB at app startup.
         */
        async hydrateComments() {
            try {
                const all = await getAllCodeComments()
                const comments = {}
                for (const comment of all) {
                    const key = buildCommentKey(comment)
                    comments[key] = comment
                }
                this.comments = comments
            } catch (err) {
                console.error('[codeComments] Failed to hydrate from IndexedDB:', err)
            }
        },

        /**
         * Add a new comment (empty content). Writes to IndexedDB immediately.
         * @param {Object} context - { projectId, sessionId, filePath, source, sourceRef }
         * @param {number} lineNumber
         */
        addComment(context, lineNumber, lineText) {
            const commentData = {
                projectId: context.projectId,
                sessionId: context.sessionId,
                filePath: context.filePath,
                source: context.source,
                sourceRef: context.sourceRef ?? '',
                lineNumber,
                lineText: lineText ?? '',
                content: '',
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }
            const key = buildCommentKey(commentData)
            if (this.comments[key]) return // already exists

            this.comments[key] = commentData
            // Save the plain object (before Vue wraps it in a reactive proxy)
            // — IndexedDB's structured clone cannot handle Proxy objects.
            saveCodeComment({ ...commentData }).catch(err =>
                console.error('[codeComments] Failed to save:', err)
            )
        },

        /**
         * Update comment content. Debounces IndexedDB write.
         * @param {Object} context - { projectId, sessionId, filePath, source, sourceRef }
         * @param {number} lineNumber
         * @param {string} content
         */
        updateComment(context, lineNumber, content) {
            const key = buildCommentKey({ ...context, sourceRef: context.sourceRef ?? '', lineNumber })
            const comment = this.comments[key]
            if (!comment) return

            comment.content = content
            comment.updatedAt = Date.now()

            // Debounce IndexedDB write — use toRaw() to unwrap the reactive
            // proxy before saving; IndexedDB's structured clone cannot handle Proxies.
            clearTimeout(_debouncers[key])
            _debouncers[key] = setTimeout(() => {
                const raw = toRaw(this.comments[key])
                if (raw) {
                    saveCodeComment({ ...raw }).catch(err =>
                        console.error('[codeComments] Failed to save:', err)
                    )
                }
                delete _debouncers[key]
            }, DEBOUNCE_MS)
        },

        /**
         * Remove a comment. Deletes from IndexedDB immediately.
         * @param {Object} context - { projectId, sessionId, filePath, source, sourceRef }
         * @param {number} lineNumber
         */
        removeComment(context, lineNumber) {
            const fields = { ...context, sourceRef: context.sourceRef ?? '', lineNumber }
            const key = buildCommentKey(fields)
            // Flush any pending debounced write
            clearTimeout(_debouncers[key])
            delete _debouncers[key]

            delete this.comments[key]
            deleteCodeComment(buildKeyArray(fields)).catch(err =>
                console.error('[codeComments] Failed to delete:', err)
            )
        },

        /** Remove all comments for a session. */
        removeAllSessionComments(projectId, sessionId) {
            const keys = Object.entries(this.comments)
                .filter(([, c]) => c.projectId === projectId && c.sessionId === sessionId)
                .map(([key, c]) => ({ key, fields: { projectId: c.projectId, sessionId: c.sessionId, filePath: c.filePath, source: c.source, sourceRef: c.sourceRef, lineNumber: c.lineNumber } }))

            for (const { key, fields } of keys) {
                clearTimeout(_debouncers[key])
                delete _debouncers[key]
                delete this.comments[key]
                deleteCodeComment(buildKeyArray(fields)).catch(err =>
                    console.error('[codeComments] Failed to delete:', err)
                )
            }
        },
    },
})

// ─── Formatting helpers ─────────────────────────────────────────────────────

/**
 * Format a single comment for insertion into the message textarea.
 */
export function formatComment(comment) {
    return `\n---\n\`${comment.filePath}\`\n<line number="${comment.lineNumber}">\n${comment.lineText}\n</line>\n<comment>\n${comment.content}\n</comment>`
}

/**
 * Format multiple comments for insertion into the message textarea.
 * Groups by file and sorts by line number for readability.
 */
export function formatAllComments(comments) {
    const sorted = [...comments].sort((a, b) =>
        a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber
    )
    return sorted.map(c => formatComment(c)).join('\n')
}

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useCodeCommentsStore, import.meta.hot))
}
