const fs = require('node:fs');
const path = require('node:path');

const IMAGE_EXTENSION = /\.(?:avif|jpe?g|png|webp)$/i;

function collectionName(folderName) {
  return folderName
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((word) => `${word[0].toLocaleUpperCase()}${word.slice(1).toLocaleLowerCase()}`)
    .join(' ') || 'Untitled Collection';
}

function imageEntries(directory, urlPrefix) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && IMAGE_EXTENSION.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    .map((entry) => ({
      name: path.parse(entry.name).name,
      url: `${urlPrefix}/${encodeURIComponent(entry.name)}`
    }));
}

function discoverFocusBackgrounds(rootDirectory) {
  const entries = fs.readdirSync(rootDirectory, { withFileTypes: true });
  const recommended = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && IMAGE_EXTENSION.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    .map((entry) => ({
      name: path.parse(entry.name).name,
      url: `/media/focus-backgrounds/${encodeURIComponent(entry.name)}`
    }));

  const collections = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    .map((entry) => {
      const urlPrefix = `/media/focus-backgrounds/${encodeURIComponent(entry.name)}`;
      const wallpapers = imageEntries(path.join(rootDirectory, entry.name), urlPrefix);
      return {
        id: entry.name,
        name: collectionName(entry.name),
        thumbnail: wallpapers[0]?.url || null,
        wallpapers
      };
    });

  return { recommended, collections };
}

module.exports = { collectionName, discoverFocusBackgrounds };
