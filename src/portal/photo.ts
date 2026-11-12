// Photos from phone cameras are often 3–8 MB: on a slow connection they are reduced in the browser
// (longest side 1600 px, JPEG) before upload. Re-encoding also drops EXIF metadata, including the
// GPS position stored by the camera. Falls back to the original file if the browser cannot decode it.
const MAX_SIDE = 1600;
const RESIZE_ABOVE = 1.2 * 1024 * 1024;

export async function preparePhoto(
  file: File,
  maxBytes: number,
): Promise<File | null> {
  if (file.size > RESIZE_ABOVE && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      const scale = Math.min(
        1,
        MAX_SIDE / Math.max(bitmap.width, bitmap.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas
        .getContext("2d")
        ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.82),
      );
      if (blob && blob.size < file.size)
        return new File([blob], "foto.jpg", { type: "image/jpeg" });
    } catch {
      // Keep the original below.
    }
  }
  return file.size <= maxBytes ? file : null;
}
