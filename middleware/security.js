const helmet = require('helmet');

const isProduction = process.env.NODE_ENV === 'production';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3001';

const securityMiddleware = helmet({
    // Content-Security-Policy — strict policy for JSON API responses
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
            scriptSrc: ["'none'"],
            styleSrc: ["'none'"],
            imgSrc: ["'none'"],
            connectSrc: ["'self'", CLIENT_URL],
            upgradeInsecureRequests: isProduction ? [] : null,
        },
    },

    // HTTP Strict Transport Security (HSTS)
    strictTransportSecurity: isProduction
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
        }
        : false,

    // X-Content-Type-Options: nosniff
    xContentTypeOptions: true,

    // Prevent clickjacking
    xFrameOptions: { action: 'deny' },

    // Cross-Origin policies
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: { policy: 'credentialless' },

    // Referrer-Policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    // DNS prefetch control
    xDnsPrefetchControl: { allow: false },

    // IE download hardening
    xDownloadOptions: true,

    // Flash / Adobe cross-domain policy
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },

    // Process isolation hint
    originAgentCluster: true,

    // Remove X-Powered-By: Express
    hidePoweredBy: true,
});

module.exports = securityMiddleware;
