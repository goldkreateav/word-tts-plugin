const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
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
    port: 3000,
    server: "https",
    headers: {
      "Access-Control-Allow-Origin": "*"
    }
  }
};
