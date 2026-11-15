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
  const path = router.currentRoute.value.path;
  if (path !== '/login' && !path.startsWith('/o/')) router.push(loginPath());
});

app.mount('#app');
