import { defineStore } from 'pinia'

/**
 * Store for terminal custom combos and snippets.
 * Data is persisted in ~/.twicc/terminal-config.json via WebSocket sync.
 */
export const useTerminalConfigStore = defineStore('terminalConfig', {
    state: () => ({
        combos: [],
        snippets: {}, // { global: [], "project:<id>": [] }
        _initialized: false,
    }),

    getters: {
        /**
         * Get snippets for display on the bar: global + current project, merged.
         * @returns {Function} (projectId: string) => Array
         */
        getSnippetsForProject: (state) => (projectId) => {
            const global = state.snippets.global || []
            const projectKey = `project:${projectId}`
            const project = state.snippets[projectKey] || []
            return [...global, ...project]
        },

        /**
         * Check if there are any snippets for a given project (global or project-specific).
         * Used for visibility logic on desktop.
         * @returns {Function} (projectId: string) => boolean
         */
        hasSnippetsForProject: (state) => (projectId) => {
            const global = state.snippets.global || []
            const projectKey = `project:${projectId}`
            const project = state.snippets[projectKey] || []
            return global.length > 0 || project.length > 0
        },

        /**
         * Get all snippet scopes that have entries, for the Manage dialog.
         * Returns a function (currentProjectId, orderedProjectIds) => Array of { scope, snippets }.
         * Order: global first, then current project, then other projects in orderedProjectIds order,
         * then any remaining scopes not covered (e.g. archived/stale projects still having snippets).
         * @returns {Function} (currentProjectId: string|null, orderedProjectIds: string[]) => Array<{ scope: string, snippets: Array }>
         */
        allSnippetScopes: (state) => (currentProjectId, orderedProjectIds) => {
            const result = []
            const currentScope = currentProjectId ? `project:${currentProjectId}` : null

            // 1. Global first (only if it has snippets)
            if ((state.snippets.global || []).length > 0) {
                result.push({ scope: 'global', snippets: state.snippets.global })
            }

            // 2. Current project (if it has snippets)
            if (currentScope && state.snippets[currentScope]?.length > 0) {
                result.push({ scope: currentScope, snippets: state.snippets[currentScope] })
            }

            // 3. Other projects in the provided order (skip current project)
            const handledScopes = new Set(result.map(r => r.scope))
            for (const pid of orderedProjectIds) {
                if (pid === currentProjectId) continue
                const scope = `project:${pid}`
                if (state.snippets[scope]?.length > 0 && !handledScopes.has(scope)) {
                    result.push({ scope, snippets: state.snippets[scope] })
                    handledScopes.add(scope)
                }
            }

            // 4. Fallback: any remaining scopes not covered (e.g. archived/stale projects with snippets)
            for (const scope of Object.keys(state.snippets)) {
                if (!scope.startsWith('project:')) continue
                if (!state.snippets[scope]?.length) continue
                if (handledScopes.has(scope)) continue
                result.push({ scope, snippets: state.snippets[scope] })
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
