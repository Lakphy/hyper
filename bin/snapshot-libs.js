require('color-convert');
require('color-string');
require('columnify');
require('lodash');
require('ms');
require('normalize-url');
require('parse-url');
require('php-escape-shell');
require('plist');
require('redux-thunk');
require('redux');
require('reselect');
require('seamless-immutable');
require('stylis');
// `electron-link` still parses snapshot inputs with an older ECMAScript target.
// Keep this addon out of the snapshot so installs don't fail on its newer syntax.
// eslint-disable-next-line no-constant-condition
if (false) {
  require('args');
  require('mousetrap');
  require('open');
  require('react-dom');
  require('react-redux');
  require('react');
}
