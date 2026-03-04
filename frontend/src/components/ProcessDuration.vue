<script setup>
/**
 * ProcessDuration - Displays a live-updating duration since a given timestamp.
 *
 * This component manages its own 1-second interval timer internally, so the
 * parent component's render function is never invalidated by the tick.
 * The timer only runs while the component is mounted (i.e., the parent has
 * confirmed the process is in assistant_turn with a valid state_changed_at).
 *
 * Supports KeepAlive: pauses the timer on deactivate, resumes on activate.
 *
 * Renders a <span> so fallthrough attributes (id, class, style) are applied
 * naturally by the parent.
 */
import { ref, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import { formatDuration } from '../utils/date'

const props = defineProps({
    /**
     * Unix timestamp (in seconds) of when the current state started.
     */
    stateChangedAt: {
        type: Number,
        required: true
    }
})

// ═══════════════════════════════════════════════════════════════════════════
// Internal timer
// ═══════════════════════════════════════════════════════════════════════════

const duration = ref(0)
let timer = null

function updateDuration() {
    duration.value = Math.max(0, Math.floor(Date.now() / 1000 - props.stateChangedAt))
}

function startTimer() {
    if (timer) return // Already running (onMounted + onActivated both fire on first mount)
    updateDuration()
    timer = setInterval(updateDuration, 1000)
}

function stopTimer() {
    if (timer) {
        clearInterval(timer)
        timer = null
    }
}

// Standard lifecycle: start on mount, stop on unmount
onMounted(startTimer)
onUnmounted(stopTimer)

// KeepAlive lifecycle: pause on deactivate, resume on activate
onActivated(startTimer)
onDeactivated(stopTimer)
</script>

<template>
    <span>{{ formatDuration(duration) }}</span>
</template>
