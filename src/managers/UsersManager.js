const User = require("../structures/User");
const Endpoints = require("../rest/Endpoints");
const LimitedManager = require("./LimitedManager");

module.exports = class UsersManager extends LimitedManager {
  #client;

  constructor (client) {
    super(client.options.cache.users, User);
    this.#client = client;
  }

  async fetch (userId) {
    return await this.#client.rest.request("get", Endpoints.USER(userId));
  }
};
