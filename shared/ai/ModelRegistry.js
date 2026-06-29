export function createModelRegistry({ models = {}, loaders = {}, metadata = {}, logger = console } = {}) {
  const modelMap = new Map(Object.entries(models || {}));
  const loaderMap = new Map(Object.entries(loaders || {}));
  const metadataMap = new Map(Object.entries(metadata || {}));
  const loadingMap = new Map();

  function register(name, modelOrLoader, modelMetadata = {}) {
    if (!name) throw new Error('model name is required');
    if (typeof modelOrLoader === 'function') {
      loaderMap.set(name, modelOrLoader);
      modelMap.delete(name);
      loadingMap.delete(name);
    } else {
      modelMap.set(name, modelOrLoader);
      loadingMap.delete(name);
    }
    metadataMap.set(name, { ...(metadataMap.get(name) || {}), ...modelMetadata });
    return name;
  }

  async function load(name) {
    if (!name) throw new Error('model name is required');
    if (modelMap.has(name)) return modelMap.get(name);
    if (loadingMap.has(name)) return loadingMap.get(name);
    const loader = loaderMap.get(name);
    if (!loader) return null;
    const promise = Promise.resolve()
      .then(() => loader({ name, metadata: metadataMap.get(name) || {} }))
      .then((model) => {
        modelMap.set(name, model);
        loadingMap.delete(name);
        return model;
      })
      .catch((err) => {
        loadingMap.delete(name);
        logger?.warn?.(`Failed to load model "${name}"`, err);
        throw err;
      });
    loadingMap.set(name, promise);
    return promise;
  }

  function get(name) {
    return modelMap.get(name) || null;
  }

  function getMetadata(name) {
    return metadataMap.get(name) || {};
  }

  function setMetadata(name, next = {}) {
    metadataMap.set(name, { ...(metadataMap.get(name) || {}), ...next });
    return metadataMap.get(name);
  }

  function clear(name = null) {
    if (!name) {
      modelMap.clear();
      loaderMap.clear();
      metadataMap.clear();
      loadingMap.clear();
      return;
    }
    modelMap.delete(name);
    loaderMap.delete(name);
    metadataMap.delete(name);
    loadingMap.delete(name);
  }

  return {
    register,
    load,
    get,
    getMetadata,
    setMetadata,
    clear,
  };
}
