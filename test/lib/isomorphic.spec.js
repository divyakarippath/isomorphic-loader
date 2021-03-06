"use strict";

/* eslint-disable prefer-template */

const fs = require("fs");
const Path = require("path");
const clone = require("clone");
const chai = require("chai");
const rimraf = require("rimraf");
const Config = require("../../lib/config");
const expect = chai.expect;
const extendRequire = require("../../lib/extend-require");
const lockFile = require("lockfile");

const configFile = Path.resolve(Config.configFile);
const lockFileName = Path.resolve(Config.lockFile);

const logger = require("../../lib/logger");

module.exports = function isomorphicExtend({ tag, webpack, webpackConfig }) {
  const SAVE_CONFIG = clone(Config);

  Config.defaultStartDelay = 0;

  function cleanup() {
    try {
      rimraf.sync(Path.resolve("test/dist"));
      // rimraf.sync(lockFileName);
      rimraf.sync(configFile);
    } catch (e) {
      //
    }
  }

  function generate(config, callback) {
    if (!callback) {
      callback = config;
      config = webpackConfig;
    }
    const compiler = webpack(config);
    compiler.run(function(err, stats) {
      stats.toString();
      callback(err);
    });
  }

  before(cleanup);

  after(() => {
    Object.assign(Config, SAVE_CONFIG);
  });

  const origLog = Object.assign({}, logger);
  let logs = [];

  beforeEach(function() {
    cleanup();
    Config.verbose = false;
    Config.reloadDelay = 10;
    logs = [];
    logger.log = function() {
      logs.push(Array.prototype.slice.apply(arguments).join(" "));
    };
    logger.error = logger.log;
  });

  afterEach(function() {
    extendRequire.deactivate();
    cleanup();
    Object.assign(logger, origLog);
  });

  const waitForUnlockConfig = callback => {
    if (!fs.existsSync(configFile)) {
      setTimeout(() => waitForUnlockConfig(callback), 500);
    } else if (fs.existsSync(lockFileName)) {
      setTimeout(() => waitForUnlockConfig(callback), 500);
    } else {
      setTimeout(callback, 0);
    }
  };

  it(`should generate assets file @${tag}`, function(done) {
    function verify() {
      chai.assert(fs.existsSync(configFile), "config file doesn't exist");
      const config = JSON.parse(fs.readFileSync(configFile));
      const assets = JSON.parse(fs.readFileSync(Path.resolve(config.assetsFile)));
      const expected = {
        chunks: {
          main: "bundle.js"
        },
        marked: {
          "test/client/images/smiley.jpg": "2029f1bb8dd109eb06f59157de62b529.jpg",
          "test/client/images/smiley2.jpg": "2029f1bb8dd109eb06f59157de62b529.jpg",
          "test/client/images/smiley.svg": "47869791f9dd9ef1be6e258e1a766ab8.svg",
          "test/client/images/smiley.png": "f958aee9742689b14418e8efef2b4032.png",
          "test/client/data/foo.bin": "71f74d0894d9ce89e22c678f0d8778b2.bin",
          "test/client/fonts/font.ttf": "1e2bf10d5113abdb2ca03d0d0f4f7dd1.ttf"
        }
      };
      expect(assets).to.deep.equal(expected);
      done();
    }

    generate(function(err) {
      if (err) done(err);
      else waitForUnlockConfig(verify);
    });
  });

  function verifyRequireAssets(publicPath) {
    publicPath = publicPath === undefined ? "/test/" : publicPath;

    const smiley = require("../client/images/smiley.jpg");
    const smiley2 = require("../client/images/smiley2.jpg");
    const smileyFull = require(Path.resolve("test/client/images/smiley.jpg"));
    const smileyPng = require("../client/images/smiley.png");
    const smileySvg = require("../client/images/smiley.svg");
    const fooBin = require("file-loader!isomorphic!../client/data/foo.bin");
    const expectedUrl = publicPath + "2029f1bb8dd109eb06f59157de62b529.jpg";

    expect(smiley).to.equal(expectedUrl);
    expect(smiley2).to.equal(expectedUrl);
    expect(smileyFull).to.equal(expectedUrl);
    expect(smileyPng).to.equal(publicPath + "f958aee9742689b14418e8efef2b4032.png");
    expect(smileySvg).to.equal(publicPath + "47869791f9dd9ef1be6e258e1a766ab8.svg");
    expect(fooBin).to.equal(publicPath + "71f74d0894d9ce89e22c678f0d8778b2.bin");

    try {
      require("bad_module");
      chai.assert(false, "expect exception");
    } catch (e) {
      expect(e).to.be.ok;
    }

    try {
      require("../client/images/smiley");
      chai.assert(false, "expect exception");
    } catch (e) {
      expect(e).to.be.ok;
    }
  }

  function verifyExtend(callback) {
    extendRequire({ startDelay: 0 }, function(err) {
      if (err) return callback(err);
      verifyRequireAssets();
      return callback();
    });
  }

  function verifyExtendPromise(callback) {
    extendRequire({ startDelay: 0 })
      .then(verifyRequireAssets)
      .then(callback);
  }

  it(`should extend require @${tag}`, function(done) {
    generate(err => {
      if (err) return done(err);
      return waitForUnlockConfig(() => verifyExtend(done));
    });
  });

  it(`should wait for generate @${tag}`, function(done) {
    let error;
    verifyExtend(err => {
      done(error || err);
    });
    setTimeout(() => {
      generate(err => (error = err));
    }, Config.pollConfigInterval + 1);
  });

  it(`should timeout if wait over waitConfigTimeout @${tag}`, function(done) {
    Config.initialWaitingNoticeDelay = 50;
    Config.waitConfigTimeout = 100;
    extendRequire({ startDelay: 0 }, function(err) {
      expect(err.message).to.equal("isomorphic-loader config not found");
      done();
    });
  });

  it(`should support Promise @${tag}`, function(done) {
    if (typeof Promise !== "undefined") {
      generate(err => {
        if (err) done(err);
        else waitForUnlockConfig(() => verifyExtendPromise(done));
      });
    } else {
      console.log("Promise not defined.  Skip test.");
      done();
    }
  });

  it(`should fail to load if config doesn't exist @${tag}`, function(done) {
    extendRequire.loadAssets(function(err) {
      expect(err).to.be.ok;
      done();
    });
  });

  it(`should fail to load if assets file doesn't exist @${tag}`, function(done) {
    generate(err => {
      if (err) return done(err);

      rimraf.sync(Path.resolve("test/dist"));
      return extendRequire.loadAssets(err2 => {
        try {
          expect(err2).to.be.ok;
          return done();
        } catch (err3) {
          return done(err3);
        }
      });
    });
  });

  it(`should fail to load if assets file is invalid @${tag}`, function(done) {
    generate(err => {
      if (err) return done(err);
      return waitForUnlockConfig(() => {
        fs.writeFileSync(Path.resolve("test/dist/isomorphic-assets.json"), "bad");

        return extendRequire.loadAssets(err2 => {
          expect(err2).to.be.ok;
          done();
        });
      });
    });
  });

  it(`should fail to extend if config file is invalid (Promise) @${tag}`, function() {
    if (typeof Promise === "undefined") {
      console.log("Promise not defined.  Skip test.");
      return undefined;
    }

    fs.writeFileSync(configFile, "bad");
    return extendRequire({ startDelay: 0 }).then(
      () => {
        chai.assert(false, "expected error");
      },
      err => {
        expect(err).to.be.ok;
      }
    );
  });

  it(`should fail to extend if config file is invalid (callback) @${tag}`, function(done) {
    fs.writeFileSync(configFile, "bad");
    extendRequire({ startDelay: 1 }, err => {
      expect(err).to.be.ok;
      done();
    });
  });

  it(`should handle undefined publicPath @${tag}`, function(done) {
    const config = clone(webpackConfig);
    delete config.output.publicPath;
    generate(config, err => {
      if (err) done(err);
      else {
        waitForUnlockConfig(() => {
          extendRequire({ startDelay: 2 }, err2 => {
            if (err2) done(err2);
            else {
              verifyRequireAssets("");
              done();
            }
          });
        });
      }
    });
  });

  it(`should handle empty publicPath @${tag}`, function(done) {
    const config = clone(webpackConfig);
    config.output.publicPath = "";
    generate(config, err => {
      if (err) done(err);
      else {
        waitForUnlockConfig(() => {
          extendRequire({ startDelay: 1 }, err2 => {
            if (err2) done(err2);
            else {
              verifyRequireAssets("");
              done();
            }
          });
        });
      }
    });
  });

  it(`should call processAssets @${tag}`, function(done) {
    const config = clone(webpackConfig);
    generate(config, err => {
      if (err) done(err);
      else {
        waitForUnlockConfig(() => {
          let processed = false;
          extendRequire(
            {
              startDelay: 1,
              processAssets: function(a) {
                processed = !!a;
                return a;
              }
            },
            function() {
              expect(processed).to.be.true;
              done();
            }
          );
        });
      }
    });
  });

  it(`setAssets should handle non-object @${tag}`, function() {
    extendRequire._instance.setAssets(null);
    expect(extendRequire._instance.assetsCount).to.equal(0);
  });

  it(`should fail if config version and package version mismatch @${tag}`, function(done) {
    generate(err => {
      if (err) done(err);
      else {
        extendRequire({ startDelay: 0, version: "0.0.1" }, function(err2) {
          expect(err2).to.be.ok;
          done();
        });
      }
    });
  });

  it(`plugin should remove existing config base on option flag @${tag}`, function() {
    const Plugin = require("../../lib/webpack-plugin");
    fs.writeFileSync(configFile, "{}");
    new Plugin({ keepExistingConfig: true }); // eslint-disable-line
    expect(fs.existsSync(configFile)).to.be.true;
    new Plugin({}); // eslint-disable-line
    expect(fs.existsSync(configFile)).to.be.false;
  });

  it(`should check lock file @${tag}`, function(done) {
    Config.lockFilePollInterval = 20;
    function verify() {
      const begin = Date.now();
      lockFile.lock(lockFileName, {}, () => {
        extendRequire(err => {
          expect(err).not.to.be.ok;
          expect(Date.now() - begin).to.be.above(20);
          done();
        });
        setTimeout(() => {
          lockFile.unlock(lockFileName);
        }, 18);
      });
    }

    generate(function(err) {
      if (err) done(err);
      else waitForUnlockConfig(verify);
    });
  });

  it(`should wait for valid config if file watcher is not setup yet @${tag}`, function(done) {
    Config.validPollInterval = 20;
    function verify() {
      const config = JSON.parse(fs.readFileSync(configFile));

      function saveConfig(valid) {
        config.valid = valid;
        config.isWebpackDev = true;
        config.assets = { marked: {} };
        config.webpackDev = {};
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
      }

      saveConfig(false);
      setTimeout(function() {
        saveConfig(true);
      }, 18);

      const begin = Date.now();
      extendRequire(function(err) {
        expect(err).not.to.be.ok;
        expect(Date.now() - begin).to.be.above(20);
        done();
      });
    }

    generate(function(err) {
      if (err) done(err);
      else waitForUnlockConfig(verify);
    });
  });

  it(`should log if write config file failed @${tag}`, function(done) {
    Config.configFile = `/.test.config.json`;
    generate(() => {
      setTimeout(() => {
        const msg = logs.find(x => x.indexOf("failed write config file") > 0);
        try {
          expect(msg).contains("failed write config file");
          return done();
        } catch (err) {
          return done(err);
        }
      }, 50);
    });
  });
};
