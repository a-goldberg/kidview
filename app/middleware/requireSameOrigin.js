const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function requestOrigin(req, configuredOrigin) {
  if (configuredOrigin) return configuredOrigin
  return `${req.protocol}://${req.get("host")}`
}

function sourceOrigin(req) {
  const value = req.get("origin") || req.get("referer")
  if (!value) return null

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

// Browsers protect Fetch Metadata and Origin/Referer headers from page scripts.
// Requiring same-origin evidence prevents another site from submitting a form
// with the parent's active KidView session, including on the login endpoint.
function requireSameOrigin(
  configuredOrigin = "",
  { allowMissingEvidence = false } = {},
) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next()

    const suppliedSourceOrigin = sourceOrigin(req)
    if (req.get("origin") || req.get("referer")) {
      if (suppliedSourceOrigin === requestOrigin(req, configuredOrigin))
        return next()
      return res
        .status(403)
        .send("This request could not be verified as coming from KidView.")
    }

    const fetchSite = req.get("sec-fetch-site")
    if (fetchSite === "same-origin") return next()

    // Some local browsers and embedded preview surfaces omit all three source
    // headers.  Permit that case only outside production.  Any explicit
    // cross-origin or malformed evidence is still rejected above.
    if (!fetchSite && allowMissingEvidence) return next()

    return res
      .status(403)
      .send("This request could not be verified as coming from KidView.")
  }
}

module.exports = requireSameOrigin
