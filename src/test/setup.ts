// Minimal ImageData polyfill for Node test environment.
// The pipeline only needs `data`, `width`, `height` and the constructor shape:
//   new ImageData(data: Uint8ClampedArray, width: number, height?: number)
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace: PredefinedColorSpace = 'srgb';

    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? data.length / 4 / width;
    }
  }
  // Expose under the standard global name. The pipeline calls `new ImageData(...)`.
  (globalThis as unknown as { ImageData: typeof ImageDataPolyfill }).ImageData = ImageDataPolyfill;
}
