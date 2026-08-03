/**
 * imageUtils.js — Compresión de imágenes en el navegador antes de subirlas
 * (evita fotos de varios MB directo desde el celular en el bucket de Storage).
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

export async function compressImage(file) {
    if (!file.type.startsWith('image/')) return file;
    if (file.size > MAX_INPUT_BYTES) {
        throw new Error(`La imagen pesa más de ${(MAX_INPUT_BYTES / 1024 / 1024).toFixed(0)}MB. Elige una más liviana.`);
    }

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}
