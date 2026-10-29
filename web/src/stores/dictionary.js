import { defineStore } from 'pinia';
import { api } from '@/api/client';

function toOptions(nodes) {
  return nodes.map((node) => ({
    value: node.id,
    label: node.name,
    children: node.children?.length ? toOptions(node.children) : undefined,
  }));
}

export const useDictionaryStore = defineStore('dictionary', {
  state: () => ({
    categories: [],
    locations: [],
    loaded: false,
    loading: false,
  }),

  getters: {
    categoryOptions: (state) => toOptions(state.categories),
    locationOptions: (state) => toOptions(state.locations),
  },

  actions: {
    async load(force = false) {
      if (this.loaded && !force) return;
      this.loading = true;
      try {
        const [categories, locations] = await Promise.all([
          api('/api/categories'),
          api('/api/locations'),
        ]);
        this.categories = categories.data;
        this.locations = locations.data;
        this.loaded = true;
      } finally {
        this.loading = false;
      }
    },

    async refresh() {
      this.loaded = false;
      await this.load(true);
    },
  },
});
