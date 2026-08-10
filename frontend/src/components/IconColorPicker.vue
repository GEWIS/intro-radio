<template>
  <div>
    <v-text-field
      v-model="query"
      class="mb-2"
      density="compact"
      hide-details
      label="Search icons (or type a full mdi-name)"
      prepend-inner-icon="mdi-magnify"
    />

    <div class="d-flex flex-wrap ga-1 mb-4" style="max-height: 160px; overflow-y: auto">
      <v-btn
        v-for="icon in filtered"
        :key="icon"
        :color="modelValue.icon === icon ? 'primary' : undefined"
        icon
        size="small"
        :variant="modelValue.icon === icon ? 'flat' : 'text'"
        @click="update('icon', icon)"
      >
        <v-icon>{{ icon }}</v-icon>
      </v-btn>

      <v-btn
        v-if="customIconCandidate"
        :color="modelValue.icon === customIconCandidate ? 'primary' : undefined"
        prepend-icon="mdi-plus"
        size="small"
        :variant="modelValue.icon === customIconCandidate ? 'flat' : 'outlined'"
        @click="update('icon', customIconCandidate)"
      >
        Use "{{ customIconCandidate }}"
      </v-btn>
    </div>

    <div class="d-flex ga-3">
      <div v-for="field in colorFields" :key="field.key">
        <div class="text-caption mb-1">{{ field.label }}</div>

        <v-menu :close-on-content-click="false">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              size="small"
              :style="{ background: modelValue[field.key] }"
              variant="outlined"
            >
              {{ modelValue[field.key] || 'pick' }}
            </v-btn>
          </template>

          <v-color-picker
            mode="hex"
            :model-value="modelValue[field.key]"
            @update:model-value="(v: string) => update(field.key, v)"
          />
        </v-menu>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgendaEvent } from '@/stores/app';
import { computed, ref } from 'vue';
import { filterIcons } from '@/composables/agendaIconCatalog';

const props = defineProps<{
  modelValue: AgendaEvent;
}>();
const emit = defineEmits<{
  'update:model-value': [AgendaEvent];
}>();

const query = ref('');

const filtered = computed(() => filterIcons(query.value));

const customIconCandidate = computed(() => {
  const q = query.value.trim();
  if (!q || filtered.value.includes(q)) return null;
  return /^mdi-[a-z0-9-]+$/.test(q) ? q : null;
});

const colorFields: { key: 'iconColor' | 'color' | 'colorDark'; label: string }[] = [
  { key: 'iconColor', label: 'Icon color' },
  { key: 'color', label: 'Background (light)' },
  { key: 'colorDark', label: 'Background (dark)' },
];

function update<K extends keyof AgendaEvent>(key: K, value: AgendaEvent[K]) {
  emit('update:model-value', { ...props.modelValue, [key]: value });
}
</script>
