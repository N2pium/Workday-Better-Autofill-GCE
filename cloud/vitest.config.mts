// Env is set here (before any test imports) so Powertools loggers start silent.
export default {
  test: {
    env: { POWERTOOLS_LOG_LEVEL: 'SILENT', POWERTOOLS_SERVICE_NAME: 'test' },
  },
};
