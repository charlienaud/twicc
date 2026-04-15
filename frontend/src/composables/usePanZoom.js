import Panzoom from '@panzoom/panzoom'
import { watch, onBeforeUnmount } from 'vue'

const MAX_SCALE = 20
const MIN_SCALE = 0.5
const ZOOM_STEP = 0.5

/**
 * Attaches @panzoom/panzoom to a Vue template ref.
 * Handles full lifecycle: init on mount, destroy on unmount or element removal.
 *
 * @param {import('vue').Ref<HTMLElement|null>} elementRef - Template ref to the element to panZoom
 * @returns {{ reset: () => void }} - Call reset() to programmatically return to 1x zoom/origin
 */
export function usePanZoom(elementRef) {
    let instance = null
    let currentEl = null
    let wheelHandler = null
    let dblclickHandler = null

    function init(el) {
        destroy()
        currentEl = el
        instance = Panzoom(el, {
            maxScale: MAX_SCALE,
            minScale: MIN_SCALE,
            step: ZOOM_STEP,
            panOnlyWhenZoomed: true,
            cursor: 'grab',
        })

        wheelHandler = (event) => instance.zoomWithWheel(event)
        // passive: false is required so zoomWithWheel can call event.preventDefault()
        el.parentElement.addEventListener('wheel', wheelHandler, { passive: false })

        dblclickHandler = () => instance.reset()
        el.addEventListener('dblclick', dblclickHandler)
    }

    function destroy() {
        if (!instance) return
        if (dblclickHandler && currentEl) {
            currentEl.removeEventListener('dblclick', dblclickHandler)
        }
        if (wheelHandler && currentEl?.parentElement) {
            currentEl.parentElement.removeEventListener('wheel', wheelHandler)
        }
        instance.destroy()
        instance = null
        currentEl = null
        wheelHandler = null
        dblclickHandler = null
    }

    function reset() {
        instance?.reset()
    }

    watch(elementRef, (el, _oldEl, onCleanup) => {
        if (el) init(el)
        onCleanup(() => destroy())
    }, { flush: 'post' })

    // onCleanup handles el → null transitions; onBeforeUnmount handles
    // teardown when the component unmounts without the ref being nullified.
    onBeforeUnmount(() => destroy())

    return { reset }
}
