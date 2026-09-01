const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'foundrai-dev-secret-change-in-production';

/**
 * Signs a JWT for a user.
 */
function signToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, display_name: user.display_name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

/**
 * Express middleware — verifies the JWT in the Authorization header.
 * Attaches req.userId and req.user on success.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.user   = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { signToken, requireAuth };
