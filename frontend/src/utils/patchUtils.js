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
