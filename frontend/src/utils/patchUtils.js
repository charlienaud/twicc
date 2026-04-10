import { applyPatch } from 'diff'

/**
 * Apply a structured patch (array of hunks from the Claude SDK's toolUseResult)
 * to a source string, returning the modified string.
 *
 * The hunks format matches the `diff` package's StructuredPatchHunk:
 * { oldStart, oldLines, newStart, newLines, lines: string[] }
 *
 * Returns null if the patch cannot be applied (should not happen with valid data).
 */
export function applyStructuredPatch(source, hunks) {
    const result = applyPatch(source, { hunks })
    // applyPatch returns false on failure
    return result === false ? null : result
}

/**
 * Reconstruct original and modified text fragments from structured patch hunks,
 * along with line number maps for correct gutter display.
 *
 * Used when structuredPatch is available but originalFile is not — we can still
 * show a much richer diff than the raw old_string/new_string fallback because
 * the hunks contain context lines and real file line numbers.
 *
 * Between non-adjacent hunks and at the top/bottom of the fragment, a sentinel
 * separator line is inserted. These are marked as `null` in the line maps so
 * that DiffEditor can render ellipsis widgets at those positions.
 *
 * @param {Array} hunks - structuredPatch array from toolUseResult
 * @returns {{ original: string, modified: string, originalLineMap: Array<number|null>, modifiedLineMap: Array<number|null> }}
 */
export function reconstructFromHunks(hunks) {
    if (!Array.isArray(hunks) || hunks.length === 0) return null

    const originalLines = []
    const modifiedLines = []
    const originalLineMap = []
    const modifiedLineMap = []

    // Sentinel separator: empty line with null in line map.
    // Used between non-adjacent hunks only (not at top/bottom — the fragment
    // edges are self-evident and don't need explicit ellipsis markers).
    function addSeparator() {
        originalLines.push('')
        modifiedLines.push('')
        originalLineMap.push(null)
        modifiedLineMap.push(null)
    }

    for (let h = 0; h < hunks.length; h++) {
        const hunk = hunks[h]

        // Separator between non-adjacent hunks
        if (h > 0) {
            addSeparator()
        }

        let origLine = hunk.oldStart
        let modLine = hunk.newStart

        for (const line of hunk.lines) {
            // Skip diff metadata lines (e.g. "\ No newline at end of file")
            if (line.startsWith('\\')) continue

            if (line.startsWith('+')) {
                modifiedLines.push(line.slice(1))
                modifiedLineMap.push(modLine++)
            } else if (line.startsWith('-')) {
                originalLines.push(line.slice(1))
                originalLineMap.push(origLine++)
            } else {
                // Context line (space prefix in standard unified diff format)
                const text = line.startsWith(' ') ? line.slice(1) : line
                originalLines.push(text)
                modifiedLines.push(text)
                originalLineMap.push(origLine++)
                modifiedLineMap.push(modLine++)
            }
        }
    }

    return {
        original: originalLines.join('\n'),
        modified: modifiedLines.join('\n'),
        originalLineMap,
        modifiedLineMap,
    }
}
