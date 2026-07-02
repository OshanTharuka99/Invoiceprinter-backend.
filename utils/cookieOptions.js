const parseExpiryToMs = (expiresIn) => {
    if (!expiresIn) return 7 * 24 * 60 * 60 * 1000;

    const match = String(expiresIn).match(/^(\d+)([dhms])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;

    const value = parseInt(match[1], 10);
    const multipliers = { d: 86400000, h: 3600000, m: 60000, s: 1000 };
    return value * multipliers[match[2]];
};

const getAuthCookieOptions = () => {
    const isProduction = process.env.NODE_ENV === 'production';

    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'strict' : 'lax',
        maxAge: parseExpiryToMs(process.env.JWT_EXPIRES_IN),
    };
};

module.exports = { getAuthCookieOptions };
