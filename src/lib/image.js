/** Redimensiona uma imagem no navegador e devolve um data URL JPEG/WebP compacto. */
export function resizeImage(file, { maxWidth = 1280, maxHeight = 1280, quality = 0.82, square = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Selecione um arquivo de imagem."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Imagem invalida."));
      image.onload = () => {
        let sx = 0;
        let sy = 0;
        let sw = image.width;
        let sh = image.height;
        if (square) {
          const side = Math.min(image.width, image.height);
          sx = (image.width - side) / 2;
          sy = (image.height - side) / 2;
          sw = side;
          sh = side;
        }
        const ratio = Math.min(1, maxWidth / sw, maxHeight / sh);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(sw * ratio);
        canvas.height = Math.round(sh * ratio);
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
