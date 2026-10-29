import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'element-plus/dist/index.css';
import './styles/tokens.css';
import './styles/glass.css';
import './styles/motion.css';
import './styles/element.css';

import App from './App.vue';
import router from './router/index.js';

const app = createApp(App);

app.use(createPinia());
app.use(router);

app.mount('#app');
