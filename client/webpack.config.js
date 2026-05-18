
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => {
  // Load appropriate .env file based on mode
  const envFile = argv.mode === 'production' ? '.env.production' : '.env';
  require('dotenv').config({ path: envFile });

  return {
  entry: './src/index.js',
  output: { 
    path: path.resolve(__dirname,'dist'), 
    filename: 'bundle.js',
    clean: true
  },
  module: {
    rules: [
      { 
        test: /\.jsx?$/, 
        exclude: /node_modules/, 
        use: { 
          loader: 'babel-loader', 
          options: { presets: ['@babel/preset-react'] } 
        } 
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
      inject: 'body'
    }),
    new webpack.DefinePlugin({
      'process.env.REACT_APP_API_URL': JSON.stringify(
        process.env.REACT_APP_API_URL || 'http://localhost:5001/api'
      )
    })
  ],
  devServer: {
    static: './dist',
    port: 8080,
    hot: true,
    historyApiFallback: true
  },
  resolve: { extensions: ['.js', '.jsx'] }
  };
};
