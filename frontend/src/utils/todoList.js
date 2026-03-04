/**
 * Utilities for TodoWrite tool data.
 */

/**
 * Build a description from a TodoWrite todos array.
 *
 * Returns an array of part objects to be joined with a separator (e.g. " — "),
 * or null if the list is empty/missing.
 *
 * Each part has:
 *  - text: the display string
 *  - status (optional): 'completed' | 'in_progress' | 'pending' — present only on
 *    parts that display an activeForm, used to render a colored icon after the text.
 *
 * Rules (in priority order):
 *  1. Empty / missing array → null
 *  2. All completed → [{ text: "Task completed" }] or [{ text: "All x tasks completed" }]
 *  3. At least one in_progress → [{ text: "x/n" }, { text: activeForm, status: "in_progress" }]
 *  4. No in_progress, some completed + some pending →
 *     [{ text: "x/n" }, { text: "done: …", status: "completed" }, { text: "next: …", status: "pending" }]
 *  5. All pending → [{ text: "n tasks" }, { text: "next: …", status: "pending" }]
 *
 * @param {Array<{content: string, status: string, activeForm: string}>} todos
 * @returns {Array<{text: string, status?: string}>|null}
 */
export function getTodoDescription(todos) {
    if (!todos || todos.length === 0) return null

    const total = todos.length
    const completedCount = todos.filter(t => t.status === 'completed').length

    // Case 1: all completed
    if (completedCount === total) {
        return [
            { text: total === 1 ? 'Task completed' : `All ${total} tasks completed`, status: 'completed' },
        ]
    }

    // Case 2: at least one in_progress — pick the last one
    const lastInProgress = findLast(todos, t => t.status === 'in_progress')
    if (lastInProgress) {
        return [
            { text: `${completedCount + 1}/${total}` },
            { text: lastInProgress.activeForm, status: 'in_progress' },
        ]
    }

    // Case 3: no in_progress, some completed → show last completed + next pending
    if (completedCount > 0) {
        const lastCompleted = findLast(todos, t => t.status === 'completed')
        const nextPending = todos.find(t => t.status === 'pending')
        return [
            { text: `${completedCount}/${total}` },
            { text: `done: ${lastCompleted.activeForm}`, status: 'completed' },
            { text: `next: ${nextPending.activeForm}`, status: 'pending' },
        ]
    }

    // Case 4: all pending
    const firstPending = todos[0]
    return [
        { text: total === 1 ? '1 task' : `${total} tasks` },
        { text: `next: ${firstPending.activeForm}`, status: 'pending' },
    ]
}

/**
 * Find the last element matching a predicate (Array.findLast polyfill-safe).
 */
function findLast(arr, predicate) {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (predicate(arr[i])) return arr[i]
    }
    return undefined
}
