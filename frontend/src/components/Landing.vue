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
          <AudioStream base-url="http://rhm1.de:8000"  mount-point="/listen.aac"/>
        </v-col>

        <v-col cols="12">
          <VideoStream src="https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8" class="mb-8"/>
        </v-col>

        <v-col cols="12">
          <UpcomingEvents />
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
              <div
                v-if="link.image"
                class="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center"
              >
                <v-img
                  :src="link.image"
                  width="32"
                  height="32"
                  class="object-cover"
                />
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
  {
    href: 'https://discord.vuetifyjs.com',
    icon: 'mdi-account-group-outline',
    subtitle: 'Common soon...',
    title: 'Radio chat',
  },
];
</script>
