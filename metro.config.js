const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

// Expo's default Metro config plus Sentry: Debug IDs in bundles + source maps
// (for the source-map upload in `npm run build:web`) and the release constant.
// - No web replay or feedback widget (decision: no session replay).
// - annotateReactComponents stays off: its Babel pass and the React Compiler
//   (app.json experiments.reactCompiler) don't mix well.
const config = getSentryExpoConfig(__dirname, {
  includeWebReplay: false,
  includeWebFeedback: false,
});

// The server pins @sentry/core 11.x at the top of node_modules, so npm nests a
// separate copy of the client's @sentry/core 10.x under every @sentry/* client
// package (react-native, react, browser, browser-utils, ...). Resolve every
// bare `@sentry/core` import from @sentry/react-native's copy so the web bundle
// carries one copy instead of several. The server build doesn't use Metro.
const sentryReactNativeDir = path.dirname(
  require.resolve("@sentry/react-native/package.json"),
);
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  if (moduleName === "@sentry/core" || moduleName.startsWith("@sentry/core/")) {
    return resolve(
      {
        ...context,
        originModulePath: path.join(sentryReactNativeDir, "package.json"),
      },
      moduleName,
      platform,
    );
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
