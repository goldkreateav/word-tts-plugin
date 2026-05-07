const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = async () => {
  let httpsServerOptions;
  try {
    // Use a dev certificate that Office can trust on Windows.
    // Requires: `npm run certs:install` (run once, may prompt for admin).
    // eslint-disable-next-line global-require
    const devCerts = require("office-addin-dev-certs");
    httpsServerOptions = await devCerts.getHttpsServerOptions();
  } catch (e) {
    // Fallback to webpack-dev-server's self-signed cert (Word may reject it).
    httpsServerOptions = undefined;
  }

  return {
    entry: {
      taskpane: "./src/taskpane/index.ts"
    },
    output: {
      clean: true,
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js"
    },
    resolve: {
      extensions: [".ts", ".js"]
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: "ts-loader",
          exclude: /node_modules/
        },
        {
          test: /\.css$/i,
          use: ["style-loader", "css-loader"]
        }
      ]
    },
    plugins: [
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["taskpane"]
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "manifest.xml",
            to: "manifest.xml"
          },
          {
            from: "config/default.json",
            to: "config/default.json"
          }
        ]
      })
    ],
    devServer: {
      static: path.join(__dirname, "dist"),
      hot: false,
      liveReload: true,
      host: "0.0.0.0",
      allowedHosts: "all",
      port: 3000,
      server: httpsServerOptions
        ? { type: "https", options: httpsServerOptions }
        : "https",
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    }
  };
};
