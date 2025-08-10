<template>
  <v-dialog v-model="open" max-width="900">
    <template #activator="{ props }">
      <v-btn v-bind="props" variant="text" size="small">Privacy policy</v-btn>
    </template>

    <v-card rounded="lg">
      <v-card-title class="d-flex align-center">
        <span class="text-h6">Privacy Policy</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="open = false" />
      </v-card-title>

      <v-divider />

      <v-card-text>
        <div v-html="html" class="markdown-body" />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import policyMd from '@/assets/privacy-policy.md?raw'

const open = ref(false)
const html = DOMPurify.sanitize(marked.parse(policyMd) as string)
</script>

<style scoped lang="sass">
.markdown-body
  :deep(h2)
    margin-top: 3rem!important
    margin-bottom: 0.6rem
</style>
