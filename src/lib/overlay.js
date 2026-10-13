/** Pilha de overlays abertos: somente o do topo responde ao Esc. */
const stack = [];
let counter = 0;

export function registerOverlay(onEscape) {
  const id = ++counter;
  stack.push({ id, onEscape });
  return () => {
    const index = stack.findIndex((item) => item.id === id);
    if (index >= 0) stack.splice(index, 1);
  };
}

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !stack.length) return;
  event.stopPropagation();
  stack[stack.length - 1].onEscape?.();
});
