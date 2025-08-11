// Utilities
import { defineStore } from 'pinia';

interface AppState {
  radio: {
    videoUrl: string;
    audioUrl: string;
    audioMountPoint: string;
    startTime: Date;
  };
  token: string;
}

export const useAppStore = defineStore('app', {
  state: () =>
    ({
      radio: {
        videoUrl: '',
        audioUrl: '',
        audioMountPoint: '',
        startTime: new Date(),
      },
      token: '',
    }) as AppState,
  getters: {
    radioInfo(state) {
      return state.radio;
    },
    isStarted(state) {
      return state.radio.startTime !== undefined && state.radio.startTime.getTime() < Date.now();
    },
  },

  actions: {
    async fetchRadioInfo() {
      return fetch('api/v1/radio')
        .then((res) => res.json())
        .then((data) => {
          this.radio.videoUrl = data.videoUrl;
          this.radio.audioUrl = data.audioUrl;
          this.radio.audioMountPoint = data.audioMountPoint;
          this.radio.startTime = new Date(data.startTime);
          return this.radio;
        })
        .catch((error) => {
          console.error(error);
        });
    },

    async fetchToken() {
      return fetch('api/v1/token')
        .then((res) => res.json())
        .then((data) => {
          this.token = data.token;
          return this.token;
        })
        .catch((error) => {
          console.error(error);
        });
    },
  },
});
