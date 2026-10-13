import { createApp } from "vue";
import App from "./App.vue";
import "./main.css";
import faviconUrl from "./assets/integradata-favicon.webp";

const faviconLink = document.querySelector("link[rel='icon']") || document.createElement("link");
faviconLink.setAttribute("rel", "icon");
faviconLink.setAttribute("type", "image/webp");
faviconLink.setAttribute("href", faviconUrl);
if (!faviconLink.parentNode) {
  document.head.appendChild(faviconLink);
}

createApp(App).mount("#app");
