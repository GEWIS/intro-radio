<template>
  <v-dialog v-model="open" max-width="900">
    <template #activator="{ props }">
      <v-btn v-bind="props" size="small" variant="text">Privacy policy</v-btn>
    </template>

    <v-card rounded="lg">
      <v-card-title class="d-flex align-center">
        <span class="text-h6">Privacy Policy</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="open = false" />
      </v-card-title>

      <v-divider />

      <v-card-text>
        <div class="markdown-body" v-html="html" />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ref } from 'vue';
import policyMd from '@/assets/privacy-policy.md?raw';

const open = ref(false);
const html = DOMPurify.sanitize(marked.parse(policyMd) as string);
</script>

<style scoped lang="sass">
.markdown-body
  :deep(h2)
    margin-top: 3rem!important
    margin-bottom: 0.6rem
</style>
