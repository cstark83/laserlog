/**
 * Express 4 doesn't forward a rejected promise from an async route handler to
 * the error middleware — it becomes an unhandled rejection instead. Wrap every
 * async handler in this so a thrown/rejected error always reaches `next(err)`.
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
