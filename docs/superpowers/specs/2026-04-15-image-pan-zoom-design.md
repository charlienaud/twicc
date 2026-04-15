# Image Pan/Zoom Design

**Date:** 2026-04-15
**Status:** Approved

## Goal

Add zoom and pan capabilities to all image displays in TwiCC, supporting desktop (mouse wheel + drag) and mobile (pinch-to-zoom + drag). Gestures only, no visible controls.

## Scope

Two integration points:
1. **MediaPreviewDialog.vue** — full-screen preview of image attachments in chat messages and drafts
2. **FilePane.vue** — image display in the Files tab (binary images and SVG preview)

## Library

**@panzoom/panzoom** (~3.5KB gzipped, zero dependencies). Handles wheel zoom, pinch-to-zoom, drag pan natively. Works on any DOM element including `<img>` with SVG blob URLs.

Alternatives considered and rejected:
- **Custom implementation** (CSS transforms + pointer events): pinch-to-zoom on mobile is complex (~150-200 lines), hard to cover all edge cases
- **VueUse composables**: no built-in pan/zoom composable, would require composing from low-level primitives (essentially the custom approach with helpers)

## Design

### Composable: `usePanZoom.js`

New file: `frontend/src/composables/usePanZoom.js`

**Interface:**
- Input: a Vue template ref pointing to the element to make zoomable
- Output: `{ reset }` function to programmatically reset zoom/pan to initial state

**Behavior:**
- Watches the template ref. When it points to a DOM element, initializes a Panzoom instance on it
- Binds `zoomWithWheel` on the parent container element (required by @panzoom/panzoom for wheel events)
- Adds a `dblclick` listener on the element for reset-to-origin
- Cleanup (destroy instance, remove listeners) via watcher `onCleanup` and `onBeforeUnmount`

**Configuration constants** (defined once at the top of the composable):
- `MAX_SCALE` — maximum zoom level
- `MIN_SCALE` — minimum zoom level
- `ZOOM_STEP` — zoom increment per wheel tick

**Panzoom options:**
- `maxScale`, `minScale`, `step` — from the constants above
- `panOnlyWhenZoomed: true` — no panning at 1x zoom, prevents unexpected dragging
- `cursor: 'grab'` — shows grab cursor at rest, grabbing during drag

### MediaPreviewDialog.vue

- Add a template ref `imageRef` on the existing `<img>` element
- Call `usePanZoom(imageRef)` to get `{ reset }`
- Watch `currentIndex`: call `reset()` on change so zoom resets when navigating between images
- CSS: `.preview-content` gets `overflow: hidden` to clip the zoomed image
- CSS: `.preview-image` gets `touch-action: none` to prevent browser interception of gestures
- Existing styles (`max-width`, `max-height`, `object-fit: contain`) remain unchanged — panzoom applies CSS transforms on top
- Nav buttons (prev/next) are siblings of the img, not children, so panzoom does not interfere with them

### FilePane.vue

- Add a template ref `imageRef` on the existing `<img>` in `.image-preview-container`
- Call `usePanZoom(imageRef)` to get `{ reset }`
- Watch `filePath`: call `reset()` when the file changes
- SVG toggle: when the ref changes element (binary img vs SVG preview img), the composable's watcher re-initializes panzoom automatically
- CSS: `.image-preview-container` changes from `overflow: auto` to `overflow: hidden`
- CSS: `.image-preview` gets `touch-action: none`
- Existing image styles remain unchanged
- No additional toolbar controls (gestures only)

### CSS and Technical Details

- **Cursor**: `grab` at rest, `grabbing` during drag — handled by @panzoom/panzoom's `cursor` option
- **Touch**: native touch event handling by the library. `touch-action: none` on the image element prevents browser gesture interception (page scroll, browser zoom)
- **Wheel**: `zoomWithWheel` bound on parent container with `{ passive: false }` to allow `preventDefault` and avoid page scroll during zoom
- **SVG**: no special treatment needed — SVGs render via `<img src="blob:...">`, panzoom treats them as any other image
- **No zoom indicator**: no percentage display, no progress bar — clean interface as requested
