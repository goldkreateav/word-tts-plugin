const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");
const dotenv = require("dotenv");

module.exports = async () => {
  dotenv.config();

  const protocol = (process.env.WORD_TTS_PROTOCOL || "http").toLowerCase();
  const useHttps = protocol !== "http";

  let httpsServerOptions;
  if (useHttps) {
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
      new webpack.DefinePlugin({
        __DEBUG__: JSON.stringify(process.env.DEBUG === "1" || process.env.DEBUG === "true"),
        __DEFAULT_TTS_API_BASE_URL__: JSON.stringify(process.env.TTS_API_BASE_URL || "")
      }),
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
      static: [
        {
          directory: path.join(__dirname, "dist"),
          publicPath: "/"
        },
        // After `npm run x`, the installer will be available at:
        // http://localhost:3000/download/WordTTS-Install.exe
        {
          directory: path.join(__dirname, "release"),
          publicPath: "/download"
        }
      ],
      hot: false,
      liveReload: true,
      host: "0.0.0.0",
      allowedHosts: "all",
      port: 3000,
      server: useHttps
        ? httpsServerOptions
          ? { type: "https", options: httpsServerOptions }
          : "https"
        : "http",
      headers: {
        "Access-Control-Allow-Origin": "*"
      }
    }
  };
};
