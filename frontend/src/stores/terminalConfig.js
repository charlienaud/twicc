import { defineStore } from 'pinia'

/**
 * Store for terminal custom combos and snippets.
 * Data is persisted in ~/.twicc/terminal-config.json via WebSocket sync.
 */
export const useTerminalConfigStore = defineStore('terminalConfig', {
    state: () => ({
        combos: [],
        snippets: {}, // { global: [], "workspace:<id>": [], "project:<id>": [] }
        _initialized: false,
    }),

    getters: {
        /**
         * Get snippets for display on the bar: global + workspace(s) + project, merged.
         * @returns {Function} (projectId: string, workspaceIds?: string[]) => Array
         */
        getSnippetsForProject: (state) => (projectId, workspaceIds = null) => {
            const global = (state.snippets.global || []).map(s => ({ ...s, _scope: 'global' }))
            const wsSnippets = (workspaceIds || []).flatMap(wsId =>
                (state.snippets[`workspace:${wsId}`] || []).map(s => ({ ...s, _scope: `workspace:${wsId}` }))
            )
            const project = (state.snippets[`project:${projectId}`] || []).map(s => ({ ...s, _scope: `project:${projectId}` }))
            return [...global, ...wsSnippets, ...project]
        },

        /**
         * Check if there are any snippets for a given project (global, workspace(s) or project-specific).
         * Used for visibility logic on desktop.
         * @returns {Function} (projectId: string, workspaceIds?: string[]) => boolean
         */
        hasSnippetsForProject: (state) => (projectId, workspaceIds = null) => {
            if ((state.snippets.global || []).length > 0) return true
            if ((state.snippets[`project:${projectId}`] || []).length > 0) return true
            return (workspaceIds || []).some(wsId => (state.snippets[`workspace:${wsId}`] || []).length > 0)
        },

        /**
         * Get all snippet scopes that have entries, for the Manage dialog.
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
            this.combos = config.combos || []
            this.snippets = config.snippets || {}
            this._initialized = true
        },

        /**
         * Send the full config to the backend via WebSocket.
         * Uses lazy import to avoid circular dependency with useWebSocket.
         */
        async _sendConfig() {
            const { sendTerminalConfig } = await import('../composables/useWebSocket')
            sendTerminalConfig({
                combos: this.combos,
                snippets: this.snippets,
            })
        },

        // ── Combo mutations ──────────────────────────────────

        addCombo(combo) {
            this.combos.push(combo)
            this._sendConfig()
        },

        updateCombo(index, combo) {
            this.combos[index] = combo
            this._sendConfig()
        },

        deleteCombo(index) {
            this.combos.splice(index, 1)
            this._sendConfig()
        },

        reorderCombo(fromIndex, toIndex) {
            if (toIndex < 0 || toIndex >= this.combos.length) return
            const [item] = this.combos.splice(fromIndex, 1)
            this.combos.splice(toIndex, 0, item)
            this._sendConfig()
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
