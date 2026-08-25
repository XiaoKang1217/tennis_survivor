import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { presentation } from './support.mjs';

const require = createRequire(import.meta.url);
const miniRoot = resolve(import.meta.dirname, '..');
const { directMediaUrl, mediaUrl } = require('../core/media');
const { matchView } = require('../core/view-model');

const available = value => ({ state: 'available', value, reasonCode: null, message: null });

test('media resolver chooses public 96 240 and 720 variants without exposing private asset keys', () => {
  const media = available({
    publicUrl: 'https://cdn.tennisapi.online/player/sinner-top.webp',
    publicAssetKey: 'players/private/bucket-key.jpg',
    variants: {
      96: { publicUrl: 'https://cdn.tennisapi.online/player/sinner-96.webp' },
      240: { publicUrl: 'https://cdn.tennisapi.online/player/sinner-240.webp' },
      720: { publicUrl: 'https://cdn.tennisapi.online/player/sinner-720.webp' }
    }
  });

  assert.equal(mediaUrl(media, { size: '96' }), 'https://cdn.tennisapi.online/player/sinner-96.webp');
  assert.equal(mediaUrl(media, { size: '240' }), 'https://cdn.tennisapi.online/player/sinner-240.webp');
  assert.equal(mediaUrl(media, { size: '720' }), 'https://cdn.tennisapi.online/player/sinner-720.webp');
  assert.equal(mediaUrl(available({ publicAssetKey: 'players/private/bucket-key.jpg' })), '');
  assert.equal(
    mediaUrl(available({ publicAssetKey: 'https://cdn.tennisapi.online/player/public.webp' })),
    'https://cdn.tennisapi.online/player/public.webp'
  );
  assert.equal(
    mediaUrl(available({ publicUrl: 'https://www.atptour.com/-/media/alias/player-headshot/s0ag' })),
    'https://www.atptour.com/-/media/alias/player-headshot/s0ag'
  );
  assert.equal(
    directMediaUrl(available({ publicUrl: 'https://www.atptour.com/-/media/alias/player-headshot/s0ag' })),
    'https://www.atptour.com/-/media/alias/player-headshot/s0ag'
  );
  assert.equal(
    mediaUrl(
      available({ publicUrl: 'https://www.atptour.com/-/media/alias/player-headshot/s0ag' }),
      { authority: 'WTA' }
    ),
    ''
  );
  assert.equal(mediaUrl('https://api.tennisapi.online/api/v1/bff/player-portrait?path=x.jpg'), '');
  assert.equal(mediaUrl('https://wtafiles.blob.core.windows.net/images/headshots/331668.jpg'), '');
  assert.equal(mediaUrl('https://photoresources.wtatennis.com/photo-resources/path/Torso_331668.jpg'), '');
});

test('media resolver remains compatible with a mini-program runtime without global URL', () => {
  const originalUrl = globalThis.URL;
  try {
    globalThis.URL = undefined;
    assert.equal(
      directMediaUrl(
        available({ publicUrl: 'https://www.atptour.com/-/media/alias/player-headshot/s0ag' }),
        { authority: 'ATP' }
      ),
      'https://www.atptour.com/-/media/alias/player-headshot/s0ag'
    );
    assert.equal(
      mediaUrl(
        available({ variants: { 96: { publicUrl: 'https://img.tennisapi.online/wta/96.webp' } } }),
        { authority: 'WTA', size: '96' }
      ),
      'https://img.tennisapi.online/wta/96.webp'
    );
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('match view resolves player portraitAvailability through the unified media resolver', () => {
  const match = presentation();
  match.participants[0].members[0].portraitAvailability = available({
    sizes: {
      240: { publicUrl: 'https://cdn.tennisapi.online/player/p1-240.webp' }
    }
  });
  match.participants[1].members[0].portraitAvailability = available({
    publicAssetKey: 'private/p2.jpg'
  });
  const view = matchView(match, { includeModules: false });

  assert.equal(
    view.sides[0].members[0].portraitUrl,
    'https://cdn.tennisapi.online/player/p1-240.webp'
  );
  assert.equal(
    view.sides[0].members[0].portraitDetailUrl,
    'https://cdn.tennisapi.online/player/p1-240.webp'
  );
  assert.equal(
    view.sides[0].members[0].portraitShareUrl,
    'https://cdn.tennisapi.online/player/p1-240.webp'
  );
  assert.equal(view.sides[1].members[0].portraitUrl, '');
});

test('player-facing pages reuse the shared media helpers instead of ad hoc publicUrl parsing', () => {
  const sources = [
    'core/view-model.js',
    'packages/player/pages/players/index.js',
    'packages/player/pages/player-detail/index.js',
    'pages/following/index.js'
  ].map(file => readFileSync(resolve(miniRoot, file), 'utf8'));

  for (const source of sources) assert.match(source, /mediaUrl/u);
  assert.match(sources.join('\n'), /directMediaUrl/u);
  assert.doesNotMatch(sources.join('\n'), /publicAssetKey\)\s*\|\||publicUrl\s*\|\|\s*[^;\n]*url/u);
});
