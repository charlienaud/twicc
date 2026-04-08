<script setup>
/**
 * GroupToggle - Clickable toggle for expanding/collapsing item groups.
 *
 * Shows "..." when collapsed, with visual feedback on hover.
 * In simplified mode, this replaces collapsed group content.
 */
import CodeCommentsIndicator from './CodeCommentsIndicator.vue'

defineProps({
    /**
     * Whether the group is currently expanded.
     */
    expanded: {
        type: Boolean,
        default: false
    },
    /**
     * Number of items in the group (optional, for future display).
     */
    itemCount: {
        type: Number,
        default: 0
    },
    /**
     * Number of code comments in this group's tools.
     */
    commentsCount: {
        type: Number,
        default: 0,
    },
})

const emit = defineEmits(['toggle'])

function handleClick() {
    emit('toggle')
}

</script>

<template>
    <div class="group-toggle">
        <wa-switch
            size="small"
            :checked="expanded"
            @change="handleClick"
        >
            <span class="toggle-label">
                <span class="toggle-label-text">
                    {{ expanded ? 'Hide' : 'View' }} {{ itemCount }} element{{ itemCount !== 1 ? 's' : '' }}
                </span>
                <CodeCommentsIndicator :count="commentsCount" :show-tooltip="false" class="toggle-comments-indicator" />
            </span>
        </wa-switch>
    </div>
</template>

<style scoped>
.group-toggle {
    display: flex;
    align-items: center;
}

wa-switch {
    --spacing-top: calc(var(--content-card-not-start-item, 1) * var(--wa-space-s));
    --spacing-bottom: calc(var(--content-card-not-end-item, 1) * var(--wa-space-s));
    margin-top: var(--spacing-top);
    margin-bottom: var(--spacing-bottom);
    display: flex;
    width: 100%;

    /* Opacity on the switch control itself, not the whole element */
    &::part(control) {
        transition: opacity 0.2s;
        opacity: 0.25;
    }
    &:hover::part(control) {
        opacity: 0.75;
    }
    &:state(checked)::part(control) {
        opacity: 1;
    }

    /* Reveal label text on hover or checked */
    &:hover .toggle-label-text {
        max-width: 15em;
        opacity: 0.75;
    }
    &:state(checked) .toggle-label-text {
        max-width: 15em;
        opacity: 1;
    }
}

.toggle-label {
    display: flex;
    align-items: center;
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
}

.toggle-label-text {
    display: inline-block;
    max-width: 0;
    overflow: hidden;
    white-space: nowrap;
    opacity: 0;
    transition: max-width 0.2s, opacity 0.2s;
}

.toggle-comments-indicator {
    font-size: 0.8em;
    margin-left: 0.25em;
}

</style>
