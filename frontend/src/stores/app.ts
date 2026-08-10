// Utilities
import { defineStore } from 'pinia';

export interface AgendaEvent {
  title: string;
  subtitle: string;
  icon: string;
  iconColor: string;
  color: string;
  colorDark: string;
  date: string;
  time: string;
}

interface AppState {
  radio: {
    videoUrl: string;
    audioUrl: string;
    audioMountPoint: string;
    startTime: Date;
  };
  token: string;
  agenda: AgendaEvent[];
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
      agenda: [],
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
      return fetch('/api/v1/radio')
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
      return fetch('/api/v1/token')
        .then((res) => res.json())
        .then((data) => {
          this.token = data;
          return this.token;
        })
        .catch((error) => {
          console.error(error);
        });
    },

    // Unlike the two fetches above, this one checks the response before
    // trusting it. The agenda is not just displayed -- backoffice/agenda.vue
    // loads it into an editor and saves the whole list back with a single
    // PUT, so quietly accepting a non-2xx body (or an HTML error page from
    // a proxy) means opening that editor on an empty list and then
    // overwriting the real schedule with whatever gets added to it. Both
    // checks below throw so the existing .catch turns any failure into
    // `undefined`, which is the caller's signal that the agenda did not
    // load and the editor must not be shown.
    async fetchAgenda() {
      return fetch('/api/v1/agenda')
        .then((res) => {
          if (!res.ok) {
            throw new Error(`GET /api/v1/agenda responded ${res.status}`);
          }
          return res.json();
        })
        .then((data) => {
          if (!Array.isArray(data)) {
            throw new TypeError('GET /api/v1/agenda did not return an array');
          }
          this.agenda = data;
          return this.agenda;
        })
        .catch((error) => {
          console.error(error);
        });
    },
  },
});
