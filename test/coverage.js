/**
 * Copyright 2017 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @param {Map<string, boolean>} apiCoverage
 * @param {Object} events
 * @param {string} className
 * @param {!Object} classType
 */
function traceAPICoverage(apiCoverage, api, events) {
  const uninstalls = [];
  for (const [name, classType] of Object.entries(api)) {
    // console.log('trace', name);
    const className = name.substring(0, 1).toLowerCase() + name.substring(1);
    for (const methodName of Reflect.ownKeys(classType.prototype)) {
      const method = Reflect.get(classType.prototype, methodName);
      if (methodName === 'constructor' || typeof methodName !== 'string' || methodName.startsWith('_') || typeof method !== 'function')
        continue;
      apiCoverage.set(`${className}.${methodName}`, false);
      const override = function(...args) {
        apiCoverage.set(`${className}.${methodName}`, true);
        return method.call(this, ...args);
      };
      Object.defineProperty(override, 'name', { writable: false, value: methodName });
      Reflect.set(classType.prototype, methodName, override);
      uninstalls.push(() => Reflect.set(classType.prototype, methodName, method));
    }
    if (events[name]) {
      const emitClassType = (name === 'BrowserContext' ? api['ChromiumBrowserContext'] : undefined) || classType;
      for (const event of Object.values(events[name])) {
        if (typeof event !== 'symbol')
          apiCoverage.set(`${className}.emit(${JSON.stringify(event)})`, false);
      }
      const method = Reflect.get(emitClassType.prototype, 'emit');
      Reflect.set(emitClassType.prototype, 'emit', function(event, ...args) {
        if (typeof event !== 'symbol' && this.listenerCount(event))
          apiCoverage.set(`${className}.emit(${JSON.stringify(event)})`, true);
        return method.call(this, event, ...args);
      });
      uninstalls.push(() => Reflect.set(emitClassType.prototype, 'emit', method));
    }
  }
  return () => uninstalls.forEach(u => u());
}

/**
 * @param {string} browserName
 */
function apiForBrowser(browserName) {
  const BROWSER_CONFIGS = [
    {
      name: 'Firefox',
      events: require('../lib/events').Events,
    },
    {
      name: 'WebKit',
      events: require('../lib/events').Events,
    },
    {
      name: 'Chromium',
      events: {
        ...require('../lib/events').Events,
        ...require('../lib/chromium/events').Events,
      }
    },
  ];
  const browserConfig = BROWSER_CONFIGS.find(config => config.name.toLowerCase() === browserName);
  const events = browserConfig.events;
  // TODO: we should rethink our api.ts approach to ensure coverage and async stacks.
  const api = {
    ...require('../lib/rpc/client/api'),
  };

  const filteredKeys = Object.keys(api).filter(apiName => {
    return !BROWSER_CONFIGS.some(config => apiName.startsWith(config.name)) || apiName.startsWith(browserConfig.name);
  });
  const filteredAPI = {};
  for (const key of filteredKeys)
    filteredAPI[key] = api[key];
  return {
    api: filteredAPI,
    events
  }
}

/**
 * @param {string} browserName
 */
function installCoverageHooks(browserName) {
  const {api, events} = apiForBrowser(browserName);
  const coverage = new Map();
  const uninstall = traceAPICoverage(coverage, api, events);
  return {coverage, uninstall};
}

module.exports = {
  installCoverageHooks
};
