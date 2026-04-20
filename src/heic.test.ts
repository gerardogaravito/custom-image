import { describe, it, expect } from 'vitest';
import { isHeic } from './heic';

function file(name: string, type = ''): File {
  return new File([new Uint8Array(0)], name, { type });
}

describe('isHeic', () => {
  describe('detects by MIME type', () => {
    it.each([
      'image/heic',
      'image/heif',
      'image/heic-sequence',
      'image/heif-sequence',
    ])('%s', (mime) => {
      expect(isHeic(file('photo.bin', mime))).toBe(true);
    });

    it('is case-insensitive on the MIME', () => {
      expect(isHeic(file('photo.bin', 'IMAGE/HEIC'))).toBe(true);
      expect(isHeic(file('photo.bin', 'Image/Heif'))).toBe(true);
    });
  });

  describe('detects by extension when MIME is missing', () => {
    it.each(['photo.heic', 'PHOTO.HEIC', 'photo.heif', 'photo.HEIF', 'IMG_1234.heic'])(
      '%s',
      (name) => {
        expect(isHeic(file(name))).toBe(true);
      },
    );
  });

  describe('returns false for non-HEIC inputs', () => {
    it.each<[string, string]>([
      ['photo.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['photo.webp', 'image/webp'],
      ['photo.gif', 'image/gif'],
      ['document.pdf', 'application/pdf'],
      ['noext', ''],
      ['heic.png', 'image/png'],
      ['contains-heic-in-name.jpg', 'image/jpeg'],
    ])('%s (%s)', (name, type) => {
      expect(isHeic(file(name, type))).toBe(false);
    });
  });
});
