import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { setUnauthorizedHandler } from './api';
import { loginPath, useSession } from './stores/session';
import './styles.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

setUnauthorizedHandler(() => {
  useSession().logout();
  const cur = router.currentRoute.value;
  // زائر الموقع العام بجلسة منتهية يبقى في الموقع؛ التحويل للدخول لشاشات النظام فقط
  if (cur.meta.open || cur.path === '/login') return;
  router.push(loginPath());
});

app.mount('#app');
