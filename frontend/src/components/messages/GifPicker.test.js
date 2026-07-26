import { mapGifResult } from './GifPicker';

describe('mapGifResult', () => {
  it('maps a GIPHY Tenor-compatible featured response into picker URLs', () => {
    const mapped = mapGifResult({
      id: 'featured-gif',
      content_description: 'A safe featured GIF',
      media_formats: {
        gif: { url: 'https://media.giphy.com/full.gif' },
        tinygif: { url: 'https://media.giphy.com/preview.gif' },
      },
    });

    expect(mapped).toEqual({
      id: 'featured-gif',
      title: 'A safe featured GIF',
      images: {
        fixed_height: { url: 'https://media.giphy.com/full.gif' },
        fixed_height_small: { url: 'https://media.giphy.com/preview.gif' },
        original: { url: 'https://media.giphy.com/full.gif' },
      },
    });
  });
});
