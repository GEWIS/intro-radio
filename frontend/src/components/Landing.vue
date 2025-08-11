<template>
  <v-container class="fill-height" max-width="900">
    <div>
      <v-img class="mb-4" height="150" src="@/assets/logo.png" />

      <div class="mb-8 text-center">
        <div class="text-body-1 font-weight-light mb-n1 gloria-hallelujah-regular">Welcome to</div>
        <h1 class="text-h3 font-weight-bold gloria-hallelujah-regular">Intro Radio</h1>
      </div>

      <v-row>
        <v-col cols="12">
          <AudioStream v-if="isStarted" :base-url="radio.audioUrl" :mount-point="radio.audioMountPoint" />
          <v-card v-else v-ripple class="py-4" color="primary" rounded="lg">
            <template #title>
              <div class="w-100 text-center">
                <h2>Going live in:</h2>
                <h4 class="mt-2">{{ formattedCountdown }}</h4>
              </div>
            </template>
          </v-card>
        </v-col>

        <v-col v-if="isStarted" cols="12">
          <VideoStream class="mb-8" :src="radio.videoUrl" />
        </v-col>

        <v-col cols="12">
          <UpcomingEvents />
        </v-col>

        <v-col v-if="isStarted" cols="12">
          <RadioChat v-if="chatActive" />
          <v-card
            v-else
            class="pa-4"
            color="surface-variant"
            rounded="lg"
            subtitle="Start a chat with the radio"
            title="Radio chat"
            variant="tonal"
            @click="startChatFlow"
          >
            <template #prepend>
              <v-icon icon="mdi-account-group-outline" />
            </template>
          </v-card>
        </v-col>

        <v-col v-if="isStarted" cols="12">
<!--          or call us -->
          <v-card
            class="pa-4"
            color="surface-variant"
            href="tel:0402478113"
            rounded="lg"
            subtitle="Instead of chatting, you can also call us live!"
            title="Call us at 040 247 8113"
            variant="tonal"
          >
            <template #prepend>
              <v-icon icon="mdi-phone" />
            </template>Or call us instead!
          </v-card>
        </v-col>

        <v-col v-for="link in links" :key="link.href" cols="12">
          <v-card
            append-icon="mdi-open-in-new"
            class="py-4"
            color="surface-variant"
            :href="link.href"
            rel="noopener noreferrer"
            rounded="lg"
            :subtitle="link.subtitle"
            target="_blank"
            :title="link.title"
            variant="tonal"
          >
            <template #prepend>
              <div v-if="link.image" class="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center">
                <v-img class="object-cover" height="32" :src="link.image" width="32" />
              </div>
              <v-icon v-else :icon="link.icon" />
            </template>
          </v-card>
        </v-col>
      </v-row>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { useCountdown } from '@/composables/useCountdown.ts';
import { useAppStore } from '@/stores/app.ts';

const store = useAppStore();

const { radio } = storeToRefs(store);

const { isStarted, formattedCountdown } = useCountdown(radio.value.startTime);

const chatActive = ref(false);
// Check for token in URL and store in localStorage
const params = new URLSearchParams(window.location.search);
const tokenParam = params.get('token');
if (tokenParam) {
  localStorage.setItem('token', tokenParam);
  chatActive.value = true;

  // Remove ?token=... from the URL without reloading
  const newUrl = window.location.origin + window.location.pathname + window.location.hash;
  window.history.replaceState({}, document.title, newUrl);
}

function startChatFlow() {
  setTimeout(() => {
    chatActive.value = true;
  }, 1000); // simulate auth delay
}

const links = [
  {
    href: 'https://intro.gewis.nl/',
    icon: 'mdi-text-box-outline',
    subtitle: 'View the schedule intro program.',
    title: 'Intro schedule',
  },
  {
    href: 'https://gewis.nl/',
    image: 'https://gewis.nl/corporateidentity/public/logo/PNG/Base_Logo_Black.png',
    subtitle: 'Find the latest photos and information about GEWIS.',
    title: 'GEWIS Website',
  },
];
</script>
