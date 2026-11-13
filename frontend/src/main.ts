import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { setUnauthorizedHandler } from './api';
import { useSession } from './stores/session';
import './styles.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);

setUnauthorizedHandler(() => {
  useSession().logout();
  if (router.currentRoute.value.path !== '/login') router.push('/login');
});

app.mount('#app');
