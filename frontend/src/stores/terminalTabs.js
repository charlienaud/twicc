import { defineStore } from 'pinia'

export const useTerminalTabsStore = defineStore('terminalTabs', {
    state: () => ({
        // sessionId → sorted array of terminal indices from backend
        indices: {},
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
        },
    },
})
