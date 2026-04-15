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


/**
 * Synchronized pan/zoom for two elements (e.g. before/after image comparison).
 * Both elements receive identical transforms via two Panzoom instances fed the same events.
 *
 * @param {import('vue').Ref<HTMLElement|null>} containerRef - Outer container for wheel capture
 * @param {import('vue').Ref<HTMLElement|null>} beforeRef - First element (e.g. "before" image)
 * @param {import('vue').Ref<HTMLElement|null>} afterRef - Second element (e.g. "after" image)
 * @returns {{ reset: () => void }}
 */
export function useSyncedPanZoom(containerRef, beforeRef, afterRef) {
    let instances = null
    let cleanupFn = null

    const panzoomOpts = {
        maxScale: MAX_SCALE,
        minScale: MIN_SCALE,
        step: ZOOM_STEP,
        panOnlyWhenZoomed: true,
        cursor: 'grab',
        noBind: true,
    }

    function init(container, beforeEl, afterEl) {
        destroy()

        const instA = Panzoom(beforeEl, panzoomOpts)
        const instB = Panzoom(afterEl, panzoomOpts)
        instances = [instA, instB]

        const handleDown = (e) => { instA.handleDown(e); instB.handleDown(e) }
        const handleMove = (e) => { instA.handleMove(e); instB.handleMove(e) }
        const handleUp = (e) => { instA.handleUp(e); instB.handleUp(e) }
        const handleWheel = (e) => { instA.zoomWithWheel(e); instB.zoomWithWheel(e) }
        const handleDblClick = () => { instA.reset(); instB.reset() }

        beforeEl.addEventListener('pointerdown', handleDown)
        afterEl.addEventListener('pointerdown', handleDown)
        document.addEventListener('pointermove', handleMove)
        document.addEventListener('pointerup', handleUp)
        container.addEventListener('wheel', handleWheel, { passive: false })
        beforeEl.addEventListener('dblclick', handleDblClick)
        afterEl.addEventListener('dblclick', handleDblClick)

        cleanupFn = () => {
            beforeEl.removeEventListener('pointerdown', handleDown)
            afterEl.removeEventListener('pointerdown', handleDown)
            document.removeEventListener('pointermove', handleMove)
            document.removeEventListener('pointerup', handleUp)
            container.removeEventListener('wheel', handleWheel)
            beforeEl.removeEventListener('dblclick', handleDblClick)
            afterEl.removeEventListener('dblclick', handleDblClick)
        }
    }

    function destroy() {
        cleanupFn?.()
        cleanupFn = null
        if (instances) {
            instances[0].destroy()
            instances[1].destroy()
            instances = null
        }
    }

    function reset() {
        if (instances) {
            instances[0].reset()
            instances[1].reset()
        }
    }

    watch(
        [containerRef, beforeRef, afterRef],
        ([container, before, after], _old, onCleanup) => {
            if (container && before && after) init(container, before, after)
            onCleanup(() => destroy())
        },
        { flush: 'post' },
    )

    onBeforeUnmount(() => destroy())

    return { reset }
}
