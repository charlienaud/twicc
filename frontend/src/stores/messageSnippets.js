import { defineStore } from 'pinia'

/**
 * Store for message input snippets (reusable text snippets for the chat input).
 * Data is persisted in ~/.twicc/message-snippets.json via WebSocket sync.
 *
 * Snippet shape: { label: string, text: string }
 * - label is optional (empty string if not set)
 * - text is the message content to insert
 */
export const useMessageSnippetsStore = defineStore('messageSnippets', {
    state: () => ({
        snippets: {}, // { global: [], "workspace:<id>": [], "project:<id>": [] }
        _initialized: false,
    }),

    getters: {
        /**
         * Get snippets for a given project: global + workspace(s) + project-specific, merged.
         * @returns {Function} (projectId: string, workspaceIds?: string[]) => Array
         */
        getSnippetsForProject: (state) => (projectId, workspaceIds = null) => {
            const global = state.snippets.global || []
            const wsSnippets = (workspaceIds || []).flatMap(wsId => state.snippets[`workspace:${wsId}`] || [])
            const project = state.snippets[`project:${projectId}`] || []
            return [...global, ...wsSnippets, ...project]
        },

        /**
         * Check if there are any snippets for a given project (global, workspace(s) or project-specific).
         * @returns {Function} (projectId: string, workspaceIds?: string[]) => boolean
         */
        hasSnippetsForProject: (state) => (projectId, workspaceIds = null) => {
            if ((state.snippets.global || []).length > 0) return true
            if ((state.snippets[`project:${projectId}`] || []).length > 0) return true
            return (workspaceIds || []).some(wsId => (state.snippets[`workspace:${wsId}`] || []).length > 0)
        },

        /**
         * Get all snippet scopes that have entries, for the manage dialog.
         * Order: global, current workspace, current project, other workspace projects,
         * other workspaces with snippets, other projects, then orphan scopes.
         * @returns {Function}
         */
        allSnippetScopes: (state) => (currentProjectId, orderedProjectIds, currentWorkspaceId = null, currentWorkspaceProjectIds = null) => {
            const result = []
            const handledScopes = new Set()

            function push(scope) {
                if (handledScopes.has(scope)) return false
                if (!state.snippets[scope]?.length) return false
                result.push({ scope, snippets: state.snippets[scope] })
                handledScopes.add(scope)
                return true
            }

            // 1. Global
            if ((state.snippets.global || []).length > 0) {
                result.push({ scope: 'global', snippets: state.snippets.global })
                handledScopes.add('global')
            }

            // 2. Current workspace
            if (currentWorkspaceId) {
                push(`workspace:${currentWorkspaceId}`)
            }

            // 3. Current project
            if (currentProjectId) {
                push(`project:${currentProjectId}`)
            }

            // 4. Other projects in current workspace
            if (currentWorkspaceProjectIds) {
                for (const pid of currentWorkspaceProjectIds) {
                    if (pid === currentProjectId) continue
                    push(`project:${pid}`)
                }
            }

            // 5. Other workspaces with snippets
            for (const scope of Object.keys(state.snippets)) {
                if (!scope.startsWith('workspace:')) continue
                push(scope)
            }

            // 6. Other projects in the provided order
            for (const pid of orderedProjectIds) {
                push(`project:${pid}`)
            }

            // 7. Orphan scopes (deleted workspaces/projects that still have snippets)
            for (const scope of Object.keys(state.snippets)) {
                if (scope === 'global') continue
                push(scope)
            }

            return result
        },
    },

    actions: {
        /**
         * Apply config received from WebSocket (on connect or broadcast).
         */
        applyConfig(config) {
            this.snippets = config.snippets || {}
            this._initialized = true
        },

        /**
         * Send the full config to the backend via WebSocket.
         * Uses lazy import to avoid circular dependency with useWebSocket.
         */
        async _sendConfig() {
            const { sendMessageSnippetsConfig } = await import('../composables/useWebSocket')
            sendMessageSnippetsConfig({
                snippets: this.snippets,
            })
        },

        // ── Snippet mutations ────────────────────────────────

        addSnippet(scope, snippet) {
            if (!this.snippets[scope]) {
                this.snippets[scope] = []
            }
            this.snippets[scope].push(snippet)
            this._sendConfig()
        },

        updateSnippet(scope, index, snippet, newScope = null) {
            if (newScope && newScope !== scope) {
                // Move to different scope
                this.snippets[scope].splice(index, 1)
                // Clean up empty scope arrays
                if (this.snippets[scope].length === 0 && scope !== 'global') {
                    delete this.snippets[scope]
                }
                if (!this.snippets[newScope]) {
                    this.snippets[newScope] = []
                }
                this.snippets[newScope].push(snippet)
            } else {
                this.snippets[scope][index] = snippet
            }
            this._sendConfig()
        },

        deleteSnippet(scope, index) {
            this.snippets[scope].splice(index, 1)
            // Clean up empty scope arrays (but keep "global" even if empty)
            if (this.snippets[scope].length === 0 && scope !== 'global') {
                delete this.snippets[scope]
            }
            this._sendConfig()
        },

        reorderSnippet(scope, fromIndex, toIndex) {
            const arr = this.snippets[scope]
            if (!arr || toIndex < 0 || toIndex >= arr.length) return
            const [item] = arr.splice(fromIndex, 1)
            arr.splice(toIndex, 0, item)
            this._sendConfig()
        },
    },
})
