import { defineStore } from 'pinia';

export interface Toast { id: number; text: string; kind: 'success' | 'error' }
let seq = 0;

/** رسائل قصيرة تظهر أعلى الشاشة وتختفي وحدها، وتفضل ظاهرة حتى بعد قفل النافذة أو تغيير الصفحة */
export const useToast = defineStore('toast', {
  state: () => ({ items: [] as Toast[] }),
  actions: {
    show(text: string, kind: Toast['kind'] = 'success') {
      const id = ++seq;
      this.items.push({ id, text, kind });
      setTimeout(() => this.dismiss(id), 3500);
    },
    success(text: string) { this.show(text, 'success'); },
    error(text: string) { this.show(text, 'error'); },
    dismiss(id: number) { this.items = this.items.filter((t) => t.id !== id); },
  },
});
