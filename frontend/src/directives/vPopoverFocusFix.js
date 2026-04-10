/**
 * Directive: v-popover-focus-fix
 *
 * Fixes the native <dialog> focus restoration behavior in wa-popover.
 * When a wa-popover closes, dialog.close() restores focus to the trigger button,
 * stealing it from whatever the user actually clicked. This directive tracks the
 * mousedown target and re-applies focus after the popover finishes hiding.
 *
 * Usage: <wa-popover v-popover-focus-fix ...>
 */

const stateMap = new WeakMap()

function captureTarget(state, e) {
    state.focusTarget = e.target
}

function onAfterShow(state) {
    document.addEventListener('mousedown', state.captureHandler, true)
}

function onAfterHide(state) {
    document.removeEventListener('mousedown', state.captureHandler, true)
    if (state.focusTarget) {
        const target = state.focusTarget
        state.focusTarget = null
        requestAnimationFrame(() => target.focus())
    }
}

export const vPopoverFocusFix = {
    mounted(el) {
        const state = { focusTarget: null }
        state.captureHandler = (e) => captureTarget(state, e)
        state.showHandler = () => onAfterShow(state)
        state.hideHandler = () => onAfterHide(state)
        stateMap.set(el, state)

        el.addEventListener('wa-after-show', state.showHandler)
        el.addEventListener('wa-after-hide', state.hideHandler)
    },
    unmounted(el) {
        const state = stateMap.get(el)
        if (!state) return
        document.removeEventListener('mousedown', state.captureHandler, true)
        el.removeEventListener('wa-after-show', state.showHandler)
        el.removeEventListener('wa-after-hide', state.hideHandler)
        stateMap.delete(el)
    },
}
