import { reactive } from "vue";

/** Roteador minimo baseado em hash: #/sistemas, #/apis/<id>, #/config/perfil ... */
export const route = reactive({ path: "sistemas", segments: ["sistemas"], query: {} });

function parse() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = hash.split("?");
  const path = decodeURIComponent(pathPart || "sistemas");
  route.path = path;
  route.segments = path.split("/").filter(Boolean);
  route.query = Object.fromEntries(new URLSearchParams(queryPart || ""));
}

window.addEventListener("hashchange", parse);
parse();

export function navigate(path, query = {}) {
  const clean = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const search = new URLSearchParams(clean).toString();
  const target = `#/${path}${search ? `?${search}` : ""}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
}

/** Atualiza a query sem criar nova entrada no historico. */
export function replaceQuery(query) {
  const clean = Object.fromEntries(Object.entries({ ...route.query, ...query }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const search = new URLSearchParams(clean).toString();
  history.replaceState(null, "", `#/${route.path}${search ? `?${search}` : ""}`);
  route.query = clean;
}
