// Generates fonts/comline-icons.woff from assets/icon-font-src/*.svg for the
// `contributes.icons` manifest entry (status bar `$(comline-mark)` glyph).
// Regenerate with `yarn build:icon-font` whenever the source SVG changes.
module.exports = {
  inputDir: './assets/icon-font-src',
  outputDir: './fonts',
  name: 'comline-icons',
  fontTypes: ['woff'],
  assetTypes: ['json'],
  codepoints: {
    'comline-mark': 0xe900,
  },
};
