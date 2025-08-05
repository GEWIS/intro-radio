<template>
  <v-container class="fill-height" max-width="900">
    <div>
      <v-img class="mb-4" height="150" src="@/assets/logo.png" />

      <div class="mb-8 text-center">
        <div class="text-body-2 font-weight-light mb-n1">Welcome to</div>
        <h1 class="text-h2 font-weight-bold">Intro Radio</h1>
      </div>

      <v-row>
        <v-col cols="12">
          <v-card
            class="py-4"
            color="primary"
            prepend-icon="mdi-play-circle-outline"
            rounded="lg"
            v-ripple
          >
            <template #title>
              <h2 class="text-h5 font-weight-bold">Click to start listening!</h2>
            </template>
          </v-card>
        </v-col>

        <v-col v-for="link in links" :key="link.href" cols="12">
          <v-card
            append-icon="mdi-open-in-new"
            class="py-4"
            color="surface-variant"
            :href="link.href"
            :prepend-icon="link.icon"
            rel="noopener noreferrer"
            rounded="lg"
            :subtitle="link.subtitle"
            target="_blank"
            :title="link.title"
            variant="tonal"
          />
        </v-col>
      </v-row>
    </div>
  </v-container>
</template>

<script setup lang="ts">
const links = [
  {
    href: 'https://vuetifyjs.com/introduction/why-vuetify/#feature-guides',
    icon: 'mdi-star-circle-outline',
    subtitle: 'View the schedule of the radio.',
    title: 'Radio Schedule',
  },
  {
    href: 'https://intro.gewis.nl/',
    icon: 'mdi-text-box-outline',
    subtitle: 'View the schedule intro program.',
    title: 'Intro schedule',
  },
  {
    href: 'https://gewis.nl/',
    icon: 'mdi-widgets-outline',
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
