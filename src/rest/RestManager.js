const axios = require("axios");
const METHODS = ["get", "post", "patch", "put", "delete", "head"];

const Bucket = require("./Bucket");
const Constants = require("../utils/Constants");

module.exports = class RestManager {
  #requestQueue;

  constructor (client) {
    this.client = client;
    this.userAgent = `Hitomi (https://github.com/IsisDiscord/hitomi, ${require("../../package.json").version})`;

    // TODO: Fazer com que o usuário escolha.
    this.apiURL = `${Constants.REST.BASE_URL}/v9`;

    this.api = buildRoute(this);
    this.ratelimits = {};
    this.globalBlocked = false;
    this.#requestQueue = [];
  };

  /**
   * Make an HTTP request to the Discord API
   * @param {String} method The HTTP method to use
   * @param {String} url URL to make the request to
   * @param {Object} [options] The options to use on the request
   * @param {Object} [options.data] The data to be sent
   * @param {Boolean} [options.authenticate] Whether to authenticate the request
   */
  async request(method, url, options) {
    const route = this.routefy(url);

    if (!this.ratelimits[route]) this.ratelimits[route] = new Bucket();
    const queue = () => this.ratelimits[route].queue(() => this.#make(method, url, options, route));

    (this.globalBlocked && options.authenticate) ? this.#requestQueue.push(() => queue()) : queue();
  }

  /**
   * Handle the HTTP request to the discord API.
   * This method is private because it doesn't handle ratelimits alone. Use RestManager#request(...)
   * @param {String} method The HTTP method to use
   * @param {String} url URL to make the request to
   * @param {Object} [options] The options to use on the request
   * @param {Object} [options.data] The data to be sent
   * @param {Boolean} [options.authenticate] Whether to authenticate the request
   * @param {String} route The cleaned route. Used for ratelimit identifying
   */
  async #make(method, url, options, route) {
    const headers = {
      "User-Agent": this.userAgent,
      "Content-Type": "application/json"
    };

    if (options?.authenticate) headers.Authorization = `Bot ${this.client.token}`;
    if (options?.data?.reason !== undefined) {
      headers["X-Audit-Log-Reason"] = options.data.reason;
      delete options.data.reason;
    }

    const result = await axios({
      url: `${this.apiURL}/${url.replace(/[/]?(\w+)/, '$1')}`,
      method: method.toLowerCase(),
      data: options.data,
      headers
    });

    if (!result || result.headers == undefined) return;

    if (this.ratelimits[route].limit === 1)
      this.ratelimits[route].limit = result.headers["x-ratelimit-limit"];

    this.ratelimits[route].remaining = Number(result.headers["x-ratelimit-remaining"]);
    this.ratelimits[route].resetAfter = Number(result.headers["x-ratelimit-reset-after"]) * 1000;

    let retryAfter = result.headers["retry-after"];
    // If retry after is not undefined, it means we hit a rate limit.
    retryAfter = retryAfter !== undefined
      ? Number(retryAfter) * 1000
      : 0;

    if (retryAfter > 0) {
      // If x-ratelimit-global is not undefined, it means we got global rate limited
      if (result.headers["x-ratelimit-global"] !== undefined) {
        this.globalBlocked = true;
        setTimeout(() => this.globalUnblock(), retryAfter);
      } else {
        this.ratelimits[route].resetAfter = retryAfter + Date.now();
      }
    }
  }

  globalUnblock() {
    this.globalBlocked = false;

    while (this.#requestQueue.length) this.#requestQueue.shift()();
  }

  routefy(url) {
    if (!/channels|guilds|webhooks/.test(url)) url = url.replace(/\d{16,18}/g, ":id")

    url = url
      .replace(/\/reactions\/[^/]+/g, "/reactions/:id")
      .replace(/\/reactions\/:id\/[^/]+/g, "/reactions/:id/:userID");

    return url;
  }
};

function buildRoute(manager, route = "/") {
  return new Proxy({}, {
    get(_, method) {
       if (method === 'toString') return () => route;

       if (METHODS.includes(method)) {
         return options =>
           manager.request(
             method,
             route.substring(0, route.length - 1),
             options
           );
       }

       return buildRoute(manager, route + method + '/');
     }
  })
}
