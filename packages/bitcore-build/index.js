'use strict';

const gulp = require('gulp');
const coveralls = require('@kollavarsham/gulp-coveralls');
const mocha = require('gulp-mocha');
const rename = require('gulp-rename');
const shell = require('gulp-shell');
const terser = require('gulp-terser');
// const bump = require('gulp-bump');
// const git = require('gulp-git');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Resolve a CLI binary by name. Tries (in order):
//   1. ./node_modules/@bitpay-labs/bitcore-build/node_modules/.bin/<bin>
//      — the legacy nested-install layout.
//   2. ./node_modules/.bin/<bin>
//      — flat install at the package's own level.
//   3. Walk up parent directories looking for node_modules/.bin/<bin>
//      — handles npm-workspaces hoisting (binaries land at the workspace
//      root, several levels up from the package being built).
// Returns the relative-to-CWD path so the existing shell-task strings stay
// the same shape.
function resolveBin(binName) {
  const candidates = [
    './node_modules/@bitpay-labs/bitcore-build/node_modules/.bin/' + binName,
    './node_modules/.bin/' + binName,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  let dir = path.resolve('.');
  while (dir !== path.dirname(dir)) {
    const cand = path.join(dir, 'node_modules', '.bin', binName);
    if (fs.existsSync(cand)) {
      const rel = path.relative('.', cand);
      return rel.startsWith('.') ? rel : './' + rel;
    }
    dir = path.dirname(dir);
  }
  // Surrender — return the conventional path so the eventual shell error is
  // recognisable.
  return './node_modules/.bin/' + binName;
}

function ignoreerror() {
  /* jshint ignore:start */ // using `this` in this context is weird
  this.emit('end');
  /* jshint ignore:end */
}

function startGulp(name, opts) {
  const task = {};
  opts = opts || {};
  opts.externals = opts.externals || [];
  opts.transforms = opts.transforms || [];
  assert(!opts.browserRunner || ['karma', 'webdriverio'].includes(opts.browserRunner), 'Invalid option - browserRunner: "' + opts.browserRunner + '"');

  const browser = !opts.skipBrowser;
  const browserRunner = opts.browserRunner || 'karma';
  const fullname = name ? 'bitcore-' + name : 'bitcore';
  const files = ['lib/**/*.js'];
  const tests = ['test/**/*.js'];
  const alljs = files.concat(tests);

  const buildPath = './node_modules/@bitpay-labs/bitcore-build/';
  const buildModulesPath = buildPath + 'node_modules/';

  // Each binary is resolved independently — under npm workspaces, hoisting
  // can land them at the monorepo root rather than the package's own
  // node_modules.
  const browserifyPath = resolveBin('browserify');
  const karmaPath = resolveBin('karma');
  const webdriverioPath = resolveBin('wdio');
  const platoPath = resolveBin('plato');
  const istanbulPath = resolveBin('istanbul');
  const mochaPath = resolveBin('_mocha');

  /**
   * testing
   */
  const testmocha = function () {
    return gulp.src(tests).pipe(mocha({
      reporter: 'spec'
    }));
  };

  task['test:karma'] = shell.task([
    karmaPath + ' start ' + (opts.karmaConf || (buildPath + 'karma.conf.js')) + ' --single-run'
  ]);

  task['test:webdriverio'] = shell.task([
    webdriverioPath + ' run ' + (opts.wdioConf || (buildPath + 'wdio.conf.js'))
  ]);

  task['test:node'] = testmocha;
  task['test:node:nofail'] = function() {
    return testmocha().on('error', ignoreerror);
  };


  task['noop']= function() {};

  /**
   * file generation
   */
  if (browser) {

    let browserifyCommand;

    if (name === 'tss') {
      browserifyCommand = browserifyPath + ' --require ./index.js:' + fullname + opts.externals.map(e => ' --external ' + e).join('') + opts.transforms.map(t => ' -t ' + t).join('') + ' -o ' + fullname + '.js';
    } else if (name !== 'lib') {
      browserifyCommand = browserifyPath + ' --require ./index.js:' + fullname + ' --external @bitpay-labs/bitcore-lib -o ' + fullname + '.js';
    } else {
      browserifyCommand = browserifyPath + ' --require ./index.js:bitcore-lib -o bitcore-lib.js';
    }

    task['browser:uncompressed'] = shell.task([
      browserifyCommand
    ]);

    task['browser:terser'] = function() {
      return gulp.src(fullname + '.js')
        .pipe(terser({
          mangle: true,
          compress: true
        }))
        .pipe(rename(fullname + '.min.js'))
        .pipe(gulp.dest('.'))
        .on('error', console.error);
    };

    task['browser:compressed'] =
      gulp.series(task['browser:uncompressed'], task['browser:terser']);

    task['browser:maketests'] = shell.task([
      'find test/ -type f -name "*.js" | xargs ' + browserifyPath + opts.externals.map(e => ' --external ' + e).join('') + opts.transforms.map(t => ' -t ' + t).join('') + ' -t brfs -o tests.js'
    ]);

    task['browser'] = task['browser:compressed'];
  }

  /**
   * code quality and documentation
   */

  //  task['lint']= function() {
  //    return gulp.src(alljs)
  //      .pipe(jshint())
  //      .pipe(jshint.reporter('default'));
  //  };

  //  task['plato']= shell.task([platoPath + ' -d report -r -l .jshintrc -t ' + fullname + ' lib']);

  task['coverage'] = shell.task([istanbulPath + ' cover ' + mochaPath + ' -- --recursive']);

  task['coveralls'] = gulp.series(task['coverage'], function() {
    gulp.src('coverage/lcov.info').pipe(coveralls());
  });

  /**
   * watch tasks
   */

  task['watch:test'] = function() {
    // todo: only run tests that are linked to file changes by doing
    // something smart like reading through the require statements
    return gulp.watch(alljs, gulp.series('test'));
  };

  task['watch:test:node'] = function() {
    // todo: only run tests that are linked to file changes by doing
    // something smart like reading through the require statements
    return gulp.watch(alljs, gulp.series('test:node'));
  };

  if (browser) {
    task['watch:test:browser'] = function() {
      // todo: only run tests that are linked to file changes by doing
      // something smart like reading through the require statements
      return gulp.watch(alljs, task['test:browser']);
    };
  }

  task['watch:coverage'] = function() {
    // todo: only run tests that are linked to file changes by doing
    // something smart like reading through the require statements
    return gulp.watch(alljs, task['coverage']);
  };

  task['watch:lint'] = function() {
    // todo: only lint files that are linked to file changes by doing
  // something smart like reading through the require statements
    return gulp.watch(alljs, task['lint']);
  };

  if (browser) {
    task['watch:browser'] = function() {
      return gulp.watch(alljs, task[browser]);
    };
  }

  if (browser) {
    task['test:browser'] = gulp.series(task['browser:uncompressed'], task['browser:maketests'], task[`test:${browserRunner}`]);
    task['test'] = gulp.series(task['test:node'], task['test:browser']);
  } else {
    task['test'] = task['test:node'];
  }
  task['default'] = task['test'];

  /**
   * Release automation
   */

  task['release:install'] = shell.task([ 'npm install']);
  return task;
}

module.exports = startGulp;

