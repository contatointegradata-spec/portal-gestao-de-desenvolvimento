import { reactive } from "vue";

// ─── Toasts ───────────────────────────────────────────────────────────────────
export const toasts = reactive([]);
let toastId = 0;

export function toast(message, type = "success", timeout = 4000) {
  const id = ++toastId;
  toasts.push({ id, message, type });
  if (timeout) setTimeout(() => dismissToast(id), timeout);
  return id;
}

toast.error = (message, timeout = 6000) => toast(message, "error", timeout);
toast.info = (message, timeout = 4000) => toast(message, "info", timeout);
toast.warn = (message, timeout = 5000) => toast(message, "warn", timeout);

export function dismissToast(id) {
  const index = toasts.findIndex((item) => item.id === id);
  if (index >= 0) toasts.splice(index, 1);
}

// ─── Dialogos (confirmacao e texto) ───────────────────────────────────────────
export const dialog = reactive({
  open: false,
  kind: "confirm",
  title: "",
  message: "",
  confirmText: "Confirmar",
  cancelText: "Cancelar",
  danger: false,
  inputLabel: "",
  inputValue: "",
  inputPlaceholder: "",
  resolve: null
});

export function confirmDialog({ title, message = "", confirmText = "Confirmar", cancelText = "Cancelar", danger = false }) {
  return new Promise((resolve) => {
    Object.assign(dialog, { open: true, kind: "confirm", title, message, confirmText, cancelText, danger, resolve });
  });
}

export function promptDialog({ title, message = "", label = "", value = "", placeholder = "", confirmText = "Salvar" }) {
  return new Promise((resolve) => {
    Object.assign(dialog, {
      open: true, kind: "prompt", title, message, confirmText, cancelText: "Cancelar", danger: false,
      inputLabel: label, inputValue: value, inputPlaceholder: placeholder, resolve
    });
  });
}

export function closeDialog(result) {
  const resolver = dialog.resolve;
  dialog.open = false;
  dialog.resolve = null;
  resolver?.(dialog.kind === "prompt" ? (result ? dialog.inputValue.trim() || null : null) : Boolean(result));
}
