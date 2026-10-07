'use strict';
const fs = require('fs');
const path = require('path');

// if running in a container, look to /run/secrets for the resend key
const readSecret = (secretName) => {
  try {
    // Path to the secret file inside the container
    const secretPath = path.join('/run/secrets', secretName);
    // Read the file content and return as a string (trimming any potential newline characters)
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch (err) {
    console.warn(`Docker secret ${secretName} not found`);
    return null;
  }
};

module.exports = { readSecret };
