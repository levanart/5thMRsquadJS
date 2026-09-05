import path from 'node:path';
import { fileURLToPath } from 'node:url';

const imageDirectory = fileURLToPath(new URL('../img/', import.meta.url));

export const imagePath = (...segments) =>
  path.join(imageDirectory, ...segments);
