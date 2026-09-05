import { registerFont } from 'canvas';
import { imagePath } from './paths.js';

registerFont(imagePath('Inter-Bold.otf'), { family: 'Inter-bold' });
registerFont(imagePath('Inter-Light.otf'), { family: 'Inter-light' });
registerFont(imagePath('Inter-Regular.otf'), { family: 'Inter-regular' });
registerFont(imagePath('AKONY.ttf'), { family: 'Akony' });
