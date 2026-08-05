// Student photo uploads are stored inline as a data URL (on the Student
// record itself, alongside name/class/etc.), so we resize + compress them
// client-side first — keeps the JSON payload and the backend's saved file
// small no matter what the source photo looked like.

const MAX_DIMENSION = 480; // px, longest side
const JPEG_QUALITY = 0.82;

/**
 * Reads an image File and returns a small, JPEG-compressed data URL
 * ("data:image/jpeg;base64,...") sized to fit within MAX_DIMENSION.
 * Rejects if the file isn't a readable image.
 */
export function fileToCompressedDataUrl(
  file,
  { maxDimension = MAX_DIMENSION, quality = JPEG_QUALITY } = {},
) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Please choose an image file (JPG, PNG, etc.)."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read that image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height / width) * maxDimension);
            width = maxDimension;
          } else {
            width = Math.round((width / height) * maxDimension);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        // Flatten transparency onto white so PNG uploads look right as JPEG.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
