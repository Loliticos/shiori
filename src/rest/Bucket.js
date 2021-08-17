const AsyncQueue = require("../utils/AsyncQueue");
const axios = require("axios");

/**
 * Returns the API latency.
 * @params {Date} serverDate The date of the server. (headers.date)
 * @returns {Date}
 */
function getAPIOffset(serverDate) {
  return new Date(serverDate).getTime() - Date.now();
}

/**
 * The date in which the ratelimit will reset.
 * @returns {Date}
 */
function calculateReset(reset, serverDate) {
  return new Date(Number(reset) * 1000).getTime() - getAPIOffset(serverDate);
}

/**
 * setTimeout but as a promise.
 * @params {Number} ms Timeout in MS
 * @returns {Promise<Boolean>}
 */
const delay = async (ms) =>
  await new Promise((resolve) => {
    setTimeout(() => resolve(true), ms)
  })

/**
  * Handle request ratelimits.
  */
class Bucket {
  /**
   * Queue used to store requests.
   * @type {AsyncQueue}
   */
  #asyncQueue = new AsyncQueue();
  /**
   * Remaining requests that can be made on this bucket.
   * @type {Number}
   */
  remaining = 1;
  /**
   * Date in which the ratelimit resets.
   * @type {Date}
   */
  reset = 0;

  constructor (manager) {
    /**
     * Rest Manager.
     * @type {RestManager}
     */
    this.manager = manager;
  }

  /**
   * Whether this bucket is inactive. (no pending requests)
   */
  get inactive() {
    return this.#asyncQueue.remaining === 0 && !(this.globalLimited || this.localLimited);
  }

  /**
   * Whether we're global blocked or not.
   * @returns {Boolean}
   */
  get globalLimited() {
    return this.globalBlocked && Date.now() < Number(this.globalReset);
  }

  /**
   * Whether we're local limited or not.
   * @returns {Boolean}
   */
  get localLimited() {
    return this.remaining <= 0 && Date.now() < this.reset;
  }

  /**
   * Queue a request into the bucket.
   * @param {String} url URL to make the request to
   * @param {Object} [options] The options to use on the request
   * @param {Object} [options.data] The data to be sent
   * @param {Boolean} [options.authenticate] Whether to authenticate the request
   * @param {String} route The cleaned route
   */
  async queueRequest (url, options, route) {
    // Wait for any previous requests to be completed before this one is run
    await this.#asyncQueue.wait();
    try {
      return await this.executeRequest(url, options, route);
    } finally {
      // Allow the next request to fire
      this.#asyncQueue.shift();
    }
  }

  /**
   * Executes a request and handle with ratelimits.
   * TODO: APIResult interface
   * @returns {APIResult}
   */
  async executeRequest (url, options, route) {
    while (this.globalLimited || this.localLimited) {
      let timeout;

      if (this.globalLimited) timeout = Number(this.globalReset) + Date.now();
      else timeout = this.reset - Date.now();

      if (this.globalLimited) {
        this.manager.client.emit(
          "debug", `We are globally rate limited, blocking all requests for ${timeout}ms`
        );
      } else {
        this.manager.client.emit("debug", `Waiting ${timeout}ms for rate limit to pass`);
      }

      await delay(timeout);
    }

    const result = await axios({ url, ...options });

    const serverDate = result.headers['date'];
    const remaining = result.headers['x-ratelimit-remaining'];
    const limit = result.headers['x-ratelimit-limit'];
    const reset = result.headers['x-ratelimit-reset'];

    this.remaining = remaining !== null ? Number(remaining) : 1;
    this.reset = reset !== null
      ? calculateReset(reset, serverDate)
      : Date.now();

    if (route.includes("reactions")) {
      this.reset = new Date(serverDate).getTime() - getAPIOffset(serverDate) + 250;
    }

    const retryAfter = Number(result.headers["retry-after"]) * 1000 ?? -1;

    if (retryAfter > 0) {
      if (result.headers["x-ratelimit-global"]) {
        this.globalBlocked = true;
        this.globalReset = Date.now() + retryAfter;
      } else {
        this.reset = retryAfter;
      }
    }

    if (result.status === 204) {
      return result.data;
    } else if (result.status === 429) {
      if (this.reset) await delay(this.reset);

      return this.executeRequest(url, options);
    }

    return result.data;
  }
};

module.exports = Bucket;
