function resolvePort(argument, environmentPort) {
  const value = argument || environmentPort;
  if (!value) return 3000;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('Port must be an integer between 1 and 65535.');
  }
  return port;
}

module.exports = resolvePort;
