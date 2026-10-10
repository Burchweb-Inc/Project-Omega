// build a centralized config object which merges config settings
// from a combination of dotenv and docker secrets
// Eventually centralize config here and load just this module
require("dotenv").config();
const docker = require("./utils/docker.js");

const config = function () {
  return {
    openrouter: {
      api_key: docker.readSecret('openrouter_api_key') || process.env.OPENROUTER_API_KEY
    },
    snarky: {
      url: process.env.SNARKYTYPE_URL || "https://snarkytype.net",
      client_id:
        docker.readSecret("snarkytype_client_id") ||
        process.env.SNARKYTYPE_CLIENT_ID,
      client_secret:
        docker.readSecret("snarkytype_client_secret") ||
        process.env.SNARKYTYPE_CLIENT_SECRET,
    }
  };
};

module.exports = config();
