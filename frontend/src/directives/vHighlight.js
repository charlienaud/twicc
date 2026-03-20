/**
 * Vue directive for highlighting search terms in DOM text content.
 *
 * Usage: v-highlight="['term1', 'term2']"
 *
 * Walks all text nodes inside the element and wraps case-insensitive matches
 * in <mark class="search-highlight"> elements. Safe to use alongside v-html:
 * highlights are cleared and re-applied on every Vue update cycle.
 *
 * The directive skips <mark> elements it created, so re-applying is safe
 * even if clearHighlights hasn't been called (though it always is).
 */

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Remove all <mark class="search-highlight"> elements, replacing them
 * with their text content, then normalize to merge adjacent text nodes.
 */
function clearHighlights(el) {
    const marks = el.querySelectorAll('mark.search-highlight')
    if (marks.length === 0) return
    for (const mark of marks) {
        mark.replaceWith(document.createTextNode(mark.textContent))
    }
    el.normalize()
}

/**
 * Walk all text nodes in the element and wrap matches in <mark> elements.
 */
function applyHighlights(el, terms) {
    if (!terms || !terms.length) return

    const pattern = terms.map(escapeRegex).filter(Boolean).join('|')
    if (!pattern) return

    // Use Unicode-aware word boundaries via \p{L} (any letter) and \p{N} (any
    // digit) property escapes, so accented characters, Cyrillic, CJK, etc. are
    // treated as word characters — consistent with Tantivy's SimpleTokenizer
    // which splits on Unicode word boundaries (UAX #29).
    // Unlike \b (which only knows [a-zA-Z0-9_]), this correctly handles e.g.
    // "café", "naïve", underscores as separators, and non-Latin scripts.
    const regex = new RegExp(`(?<=^|[^\\p{L}\\p{N}])(${pattern})(?=$|[^\\p{L}\\p{N}])`, 'giu')

    // Collect all text nodes first to avoid live-mutation issues
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const textNodes = []
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode)
    }

    for (const textNode of textNodes) {
        const text = textNode.textContent
        if (!text.trim()) continue

        regex.lastIndex = 0
        if (!regex.test(text)) continue

        // Build a fragment with text + <mark> nodes
        regex.lastIndex = 0
        const frag = document.createDocumentFragment()
        let lastIdx = 0
        let match

        while ((match = regex.exec(text)) !== null) {
            // Text before the match
            if (match.index > lastIdx) {
                frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)))
            }
            // The highlighted match
            const mark = document.createElement('mark')
            mark.className = 'search-highlight'
            mark.textContent = match[0]
            frag.appendChild(mark)
            lastIdx = regex.lastIndex
        }

        // Remaining text after last match
        if (lastIdx < text.length) {
            frag.appendChild(document.createTextNode(text.slice(lastIdx)))
        }

        textNode.replaceWith(frag)
    }
}

/**
 * Clear existing highlights, then apply new terms.
 */
function highlight(el, terms) {
    clearHighlights(el)
    if (terms && terms.length) {
        applyHighlights(el, terms)
    }
}

export const vHighlight = {
    mounted(el, binding) {
        if (binding.value && binding.value.length) {
            highlight(el, binding.value)
        }
    },
    updated(el, binding) {
        highlight(el, binding.value || [])
    },
    beforeUnmount(el) {
        clearHighlights(el)
    },
}
