const fs = require("fs");
const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");
const dotenv = require("dotenv");

const isDockerRuntime = () => process.env.DOCKER === "1" || fs.existsSync("/.dockerenv");

const loadHttpsServerOptions = async (inDocker) => {
  const certDir = (process.env.OFFICE_ADDIN_DEV_CERTS_DIR || "").trim();
  if (certDir) {
    const keyPath = path.join(certDir, "localhost.key");
    const certPath = path.join(certDir, "localhost.crt");
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      };
    }
    if (inDocker) {
      // eslint-disable-next-line no-console
      console.error(
        `[word-tts] HTTPS: no localhost.key/localhost.crt in ${certDir}. ` +
          "On the host run: npm run certs:install"
      );
      return undefined;
    }
  }

  if (inDocker) {
    // eslint-disable-next-line no-console
    console.error(
      "[word-tts] HTTPS in Docker requires mounting dev certs, e.g. " +
        "~/.office-addin-dev-certs:/certs and OFFICE_ADDIN_DEV_CERTS_DIR=/certs"
    );
    return undefined;
  }

  try {
    // eslint-disable-next-line global-require
    const devCerts = require("office-addin-dev-certs");
    return await devCerts.getHttpsServerOptions();
  } catch {
    return undefined;
  }
};

module.exports = async () => {
  const inDocker = isDockerRuntime();
  dotenv.config({ quiet: inDocker });

  const protocol = (process.env.WORD_TTS_PROTOCOL || "http").trim().toLowerCase();
  const useHttps = protocol === "https";

  const httpsServerOptions = useHttps ? await loadHttpsServerOptions(inDocker) : undefined;
  if (useHttps && !httpsServerOptions) {
    throw new Error(
      inDocker
        ? "HTTPS dev server in Docker needs host certs mounted (see docker-compose.yml)."
        : "HTTPS dev server needs dev certs. Run: npm run certs:install"
    );
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
      liveReload: !inDocker,
      host: "0.0.0.0",
      allowedHosts: "all",
      port: 3000,
      ...(inDocker
        ? {
            client: {
              webSocketURL: {
                protocol: useHttps ? "wss" : "ws",
                hostname: "localhost",
                port: 3000,
                pathname: "/ws"
              }
            }
          }
        : {}),
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
