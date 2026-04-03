import { defineStore } from 'pinia'

export const useTerminalTabsStore = defineStore('terminalTabs', {
    state: () => ({
        // sessionId → sorted array of terminal indices from backend
        indices: {},
        // sessionId → { terminalIndex: label } — labels from tmux user options
        labels: {},
    }),
    actions: {
        setIndices(sessionId, terminalIndices) {
            this.indices[sessionId] = [...terminalIndices].sort((a, b) => a - b)
        },
        addIndex(sessionId, index) {
            if (!this.indices[sessionId]) {
                this.indices[sessionId] = []
            }
            if (!this.indices[sessionId].includes(index)) {
                this.indices[sessionId].push(index)
                this.indices[sessionId].sort((a, b) => a - b)
            }
        },
        removeIndex(sessionId, index) {
            if (this.indices[sessionId]) {
                this.indices[sessionId] = this.indices[sessionId].filter(i => i !== index)
            }
            // Clean up label for removed terminal
            if (this.labels[sessionId]) {
                delete this.labels[sessionId][index]
            }
        },

        /**
         * Bulk-set labels from backend (used with terminal_list response).
         * @param {string} sessionId
         * @param {Object} labelsMap - { terminalIndex: label } (string keys from JSON)
         */
        setLabels(sessionId, labelsMap) {
            this.labels[sessionId] = {}
            for (const [index, label] of Object.entries(labelsMap)) {
                if (label) {
                    this.labels[sessionId][Number(index)] = label
                }
            }
        },

        /**
         * Set or clear a single terminal label.
         * @param {string} sessionId
         * @param {number} index
         * @param {string} label - empty string to clear
         */
        setLabel(sessionId, index, label) {
            if (!this.labels[sessionId]) {
                this.labels[sessionId] = {}
            }
            if (label) {
                this.labels[sessionId][index] = label
            } else {
                delete this.labels[sessionId][index]
            }
        },

        /**
         * Get the label for a terminal, or empty string if none.
         * @param {string} sessionId
         * @param {number} index
         * @returns {string}
         */
        getLabel(sessionId, index) {
            return this.labels[sessionId]?.[index] || ''
        },
    },
})
